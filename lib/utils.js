"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.MINIMAL_ECS_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.SingletonLogType = void 0;
exports.singletonLambda = singletonLambda;
exports.singletonLogGroup = singletonLogGroup;
exports.discoverCertificateFiles = discoverCertificateFiles;
exports.isGpuInstanceType = isGpuInstanceType;
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
/**
 * Returns true if the instance type has an NVIDIA GPU.
 *
 * Uses AWS naming convention: most NVIDIA GPU instances use 'g' (g4dn, g5, g6, g9...) or 'p' (p3, p4d, p5, p6...)
 * prefix followed by a digit. Explicitly excludes known non-NVIDIA GPU families such as g4ad (AMD).
 *
 * @internal
 */
function isGpuInstanceType(instanceType) {
    const s = instanceType.toString().toLowerCase();
    // Match GPU instance families starting with g/p + digit, but exclude known non-NVIDIA GPU families.
    return /^[gp]\d+(?!ad)/.test(s);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBV0EsMENBWUM7QUFrQkQsOENBV0M7QUE4REQsNERBOEJDO0FBVUQsOENBSUM7QUE5SkQseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3Qiw2Q0FBcUc7QUFDckcsbUNBQW1DO0FBR25DOzs7O0dBSUc7QUFDSCxTQUFnQixlQUFlLENBQzdCLFlBQXVGLEVBQ3ZGLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQThCO0lBRTVELE1BQU0sYUFBYSxHQUFHLEdBQUcsRUFBRSx1Q0FBdUMsQ0FBQztJQUNuRSxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQ3RFLElBQUksUUFBUSxFQUFFLENBQUM7UUFDYiwyQkFBMkI7UUFDM0IsT0FBTyxRQUF3QixDQUFDO0lBQ2xDLENBQUM7SUFFRCxPQUFPLElBQUksWUFBWSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLGFBQWEsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUNyRSxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILElBQVksZ0JBSVg7QUFKRCxXQUFZLGdCQUFnQjtJQUMxQix5RUFBcUQsQ0FBQTtJQUNyRCxxREFBaUMsQ0FBQTtJQUNqQyx1Q0FBbUIsQ0FBQTtBQUNyQixDQUFDLEVBSlcsZ0JBQWdCLGdDQUFoQixnQkFBZ0IsUUFJM0I7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQUMsS0FBZ0IsRUFBRSxJQUFzQjtJQUN4RSxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzdE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RCxNQUFNLEtBQUssQ0FBQztJQUNkLENBQUM7SUFFRCxPQUFPLGdCQUFnQixDQUFDO0FBQzFCLENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQUMsWUFBOEI7SUFDOUQsTUFBTSxDQUFDLEdBQUcsWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ2hELG9HQUFvRztJQUNwRyxPQUFPLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGF3c19lYzIgYXMgZWMyLCBhd3NfaWFtIGFzIGlhbSwgYXdzX2xhbWJkYSBhcyBsYW1iZGEsIGF3c19sb2dzIGFzIGxvZ3MgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBvciByZXR1cm4gYSBzaW5nbGV0b24gTGFtYmRhIGZ1bmN0aW9uIGluc3RhbmNlLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2luZ2xldG9uTGFtYmRhPEZ1bmN0aW9uVHlwZSBleHRlbmRzIGxhbWJkYS5GdW5jdGlvbj4oXG4gIGZ1bmN0aW9uVHlwZTogbmV3IChzOiBDb25zdHJ1Y3QsIGk6IHN0cmluZywgcD86IGxhbWJkYS5GdW5jdGlvbk9wdGlvbnMpID0+IEZ1bmN0aW9uVHlwZSxcbiAgc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBsYW1iZGEuRnVuY3Rpb25PcHRpb25zKTogRnVuY3Rpb25UeXBlIHtcblxuICBjb25zdCBjb25zdHJ1Y3ROYW1lID0gYCR7aWR9LWRjYzAzNmM4LTg3NmItNDUxZS1hMmMxLTU1MmY5ZTA2ZTllMWA7XG4gIGNvbnN0IGV4aXN0aW5nID0gY2RrLlN0YWNrLm9mKHNjb3BlKS5ub2RlLnRyeUZpbmRDaGlsZChjb25zdHJ1Y3ROYW1lKTtcbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgLy8gSnVzdCBhc3N1bWUgdGhpcyBpcyB0cnVlXG4gICAgcmV0dXJuIGV4aXN0aW5nIGFzIEZ1bmN0aW9uVHlwZTtcbiAgfVxuXG4gIHJldHVybiBuZXcgZnVuY3Rpb25UeXBlKGNkay5TdGFjay5vZihzY29wZSksIGNvbnN0cnVjdE5hbWUsIHByb3BzKTtcbn1cblxuLyoqXG4gKiBDZW50cmFsIGxvZyBncm91cCB0eXBlLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZW51bSBTaW5nbGV0b25Mb2dUeXBlIHtcbiAgUlVOTkVSX0lNQUdFX0JVSUxEID0gJ1J1bm5lciBJbWFnZSBCdWlsZCBIZWxwZXJzIExvZycsXG4gIE9SQ0hFU1RSQVRPUiA9ICdPcmNoZXN0cmF0b3IgTG9nJyxcbiAgU0VUVVAgPSAnU2V0dXAgTG9nJyxcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIG9yIHJldHVybiBjZW50cmFsIGxvZyBncm91cCBpbnN0YW5jZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbmdsZXRvbkxvZ0dyb3VwKHNjb3BlOiBDb25zdHJ1Y3QsIHR5cGU6IFNpbmdsZXRvbkxvZ1R5cGUpOiBsb2dzLklMb2dHcm91cCB7XG4gIGNvbnN0IGV4aXN0aW5nID0gY2RrLlN0YWNrLm9mKHNjb3BlKS5ub2RlLnRyeUZpbmRDaGlsZCh0eXBlKTtcbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgLy8gSnVzdCBhc3N1bWUgdGhpcyBpcyB0cnVlXG4gICAgcmV0dXJuIGV4aXN0aW5nIGFzIGxvZ3MuSUxvZ0dyb3VwO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBsb2dzLkxvZ0dyb3VwKGNkay5TdGFjay5vZihzY29wZSksIHR5cGUsIHtcbiAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGFic29sdXRlIG1pbmltdW0gcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXIgdG8gd29yay4gVW5saWtlIGBBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlYCwgaXQgZG9lc24ndCBnaXZlIHBlcm1pc3Npb24gdG8gcmVhZCBhbGwgU1NNIHBhcmFtZXRlcnMuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjb25zdCBNSU5JTUFMX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgYWN0aW9uczogW1xuICAgICdzc21tZXNzYWdlczpDcmVhdGVDb250cm9sQ2hhbm5lbCcsXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZURhdGFDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkRhdGFDaGFubmVsJyxcbiAgXSxcbiAgcmVzb3VyY2VzOiBbJyonXSxcbn0pO1xuXG4vKipcbiAqIFRoZSBhYnNvbHV0ZSBtaW5pbXVtIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBTU00gU2Vzc2lvbiBNYW5hZ2VyIG9uIEVDUyB0byB3b3JrLiBVbmxpa2UgYEFtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmVgLCBpdCBkb2Vzbid0IGdpdmUgcGVybWlzc2lvbiB0byByZWFkIGFsbCBTU00gcGFyYW1ldGVycy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IE1JTklNQUxfRUNTX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgYWN0aW9uczogW1xuICAgICdzc21tZXNzYWdlczpDcmVhdGVDb250cm9sQ2hhbm5lbCcsXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZURhdGFDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkRhdGFDaGFubmVsJyxcbiAgICAnczM6R2V0RW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24nLFxuICBdLFxuICByZXNvdXJjZXM6IFsnKiddLFxufSk7XG5cbi8qKlxuICogVGhlIGFic29sdXRlIG1pbmltdW0gcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXIgb24gRUMyIHRvIHdvcmsuIFVubGlrZSBgQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZWAsIGl0IGRvZXNuJ3QgZ2l2ZSBwZXJtaXNzaW9uIHRvIHJlYWQgYWxsIFNTTSBwYXJhbWV0ZXJzLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgTUlOSU1BTF9FQzJfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICBhY3Rpb25zOiBbXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZUNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6Q3JlYXRlRGF0YUNoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuQ29udHJvbENoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuRGF0YUNoYW5uZWwnLFxuICAgICdzMzpHZXRFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgJ3NzbTpVcGRhdGVJbnN0YW5jZUluZm9ybWF0aW9uJyxcbiAgXSxcbiAgcmVzb3VyY2VzOiBbJyonXSxcbn0pO1xuXG4vKipcbiAqIERpc2NvdmVycyBjZXJ0aWZpY2F0ZSBmaWxlcyBmcm9tIGEgZ2l2ZW4gcGF0aCAoZmlsZSBvciBkaXJlY3RvcnkpLlxuICpcbiAqIElmIHRoZSBwYXRoIGlzIGEgZGlyZWN0b3J5LCBmaW5kcyBhbGwgLnBlbSBhbmQgLmNydCBmaWxlcyBpbiBpdC5cbiAqIElmIHRoZSBwYXRoIGlzIGEgZmlsZSwgcmV0dXJucyBpdCBhcyBhIHNpbmdsZSBjZXJ0aWZpY2F0ZSBmaWxlLlxuICpcbiAqIEBwYXJhbSBzb3VyY2VQYXRoIHBhdGggdG8gYSBjZXJ0aWZpY2F0ZSBmaWxlIG9yIGRpcmVjdG9yeSBjb250YWluaW5nIGNlcnRpZmljYXRlIGZpbGVzXG4gKiBAcmV0dXJucyBhcnJheSBvZiBjZXJ0aWZpY2F0ZSBmaWxlIHBhdGhzLCBzb3J0ZWQgYWxwaGFiZXRpY2FsbHlcbiAqIEB0aHJvd3MgRXJyb3IgaWYgcGF0aCBkb2Vzbid0IGV4aXN0LCBpcyBuZWl0aGVyIGZpbGUgbm9yIGRpcmVjdG9yeSwgb3IgZGlyZWN0b3J5IGhhcyBubyBjZXJ0aWZpY2F0ZSBmaWxlc1xuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY292ZXJDZXJ0aWZpY2F0ZUZpbGVzKHNvdXJjZVBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgbGV0IGNlcnRpZmljYXRlRmlsZXM6IHN0cmluZ1tdID0gW107XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoc291cmNlUGF0aCk7XG4gICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgLy8gUmVhZCBkaXJlY3RvcnkgYW5kIGZpbmQgYWxsIC5wZW0gYW5kIC5jcnQgZmlsZXNcbiAgICAgIGNvbnN0IGZpbGVzID0gZnMucmVhZGRpclN5bmMoc291cmNlUGF0aCk7XG4gICAgICBjZXJ0aWZpY2F0ZUZpbGVzID0gZmlsZXNcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5wZW0nKSB8fCBmaWxlLmVuZHNXaXRoKCcuY3J0JykpXG4gICAgICAgIC5tYXAoZmlsZSA9PiBwYXRoLmpvaW4oc291cmNlUGF0aCwgZmlsZSkpXG4gICAgICAgIC5zb3J0KCk7IC8vIFNvcnQgZm9yIGNvbnNpc3RlbnQgb3JkZXJpbmdcblxuICAgICAgaWYgKGNlcnRpZmljYXRlRmlsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY2VydGlmaWNhdGUgZmlsZXMgKC5wZW0gb3IgLmNydCkgZm91bmQgaW4gZGlyZWN0b3J5OiAke3NvdXJjZVBhdGh9YCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChzdGF0LmlzRmlsZSgpKSB7XG4gICAgICAvLyBTaW5nbGUgZmlsZSAtIGJhY2t3YXJkcyBjb21wYXRpYmxlXG4gICAgICBjZXJ0aWZpY2F0ZUZpbGVzID0gW3NvdXJjZVBhdGhdO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENlcnRpZmljYXRlIHNvdXJjZSBwYXRoIGlzIG5laXRoZXIgYSBmaWxlIG5vciBhIGRpcmVjdG9yeTogJHtzb3VyY2VQYXRofWApO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2VydGlmaWNhdGUgc291cmNlIHBhdGggZG9lcyBub3QgZXhpc3Q6ICR7c291cmNlUGF0aH1gKTtcbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICByZXR1cm4gY2VydGlmaWNhdGVGaWxlcztcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRydWUgaWYgdGhlIGluc3RhbmNlIHR5cGUgaGFzIGFuIE5WSURJQSBHUFUuXG4gKlxuICogVXNlcyBBV1MgbmFtaW5nIGNvbnZlbnRpb246IG1vc3QgTlZJRElBIEdQVSBpbnN0YW5jZXMgdXNlICdnJyAoZzRkbiwgZzUsIGc2LCBnOS4uLikgb3IgJ3AnIChwMywgcDRkLCBwNSwgcDYuLi4pXG4gKiBwcmVmaXggZm9sbG93ZWQgYnkgYSBkaWdpdC4gRXhwbGljaXRseSBleGNsdWRlcyBrbm93biBub24tTlZJRElBIEdQVSBmYW1pbGllcyBzdWNoIGFzIGc0YWQgKEFNRCkuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0dwdUluc3RhbmNlVHlwZShpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGUpOiBib29sZWFuIHtcbiAgY29uc3QgcyA9IGluc3RhbmNlVHlwZS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7XG4gIC8vIE1hdGNoIEdQVSBpbnN0YW5jZSBmYW1pbGllcyBzdGFydGluZyB3aXRoIGcvcCArIGRpZ2l0LCBidXQgZXhjbHVkZSBrbm93biBub24tTlZJRElBIEdQVSBmYW1pbGllcy5cbiAgcmV0dXJuIC9eW2dwXVxcZCsoPyFhZCkvLnRlc3Qocyk7XG59XG4iXX0=