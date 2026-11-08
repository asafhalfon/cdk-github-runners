"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.MINIMAL_ECS_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.SingletonLogType = void 0;
exports.singletonLambda = singletonLambda;
exports.singletonRole = singletonRole;
exports.singletonLogGroup = singletonLogGroup;
exports.discoverCertificateFiles = discoverCertificateFiles;
exports.dedupeStateMachineTokens = dedupeStateMachineTokens;
exports.isGpuInstanceType = isGpuInstanceType;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk = __importStar(require("aws-cdk-lib"));
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
 * Initialize or return a singleton role instance.
 *
 * @internal
 */
function singletonRole(scope, id, assumedBy) {
    const constructName = `${id}-dcc036c8-876b-451e-a2c1-552f9e06e9e1`;
    const existing = cdk.Stack.of(scope).node.tryFindChild(constructName);
    if (existing) {
        // Just assume this is true
        return existing;
    }
    return new aws_cdk_lib_1.aws_iam.Role(cdk.Stack.of(scope), constructName, { assumedBy });
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
 * De-duplicate repeated CloudFormation tokens (shared subnet ids, cluster ARNs, cross-stack `Fn::ImportValue`s, ...) found in a Step Functions
 * definition fragment into a `definitionSubstitutions` map. Each distinct token gets a single `${__sfnsub_N}` placeholder, so its intrinsic renders
 * once in the template instead of once per occurrence (e.g. once per provider sharing a VPC). `obj` is mutated in place, replacing every token leaf
 * with its placeholder; the returned map is meant to be passed straight to `StateMachine`'s `definitionSubstitutions`.
 *
 * This is safe only because the definition fragment contains no other `${...}` sequences: JSONata uses `{% %}`, and the EC2 user data escapes its
 * braces (rendered as `$\{...\}`), so Step Functions' substitution leaves everything but our synthetic placeholders untouched. A literal `${`
 * reaching this function can only come from user input (a tag value, a construct id, ...), so it's reported as an error instead of silently producing
 * a definition that Step Functions rejects with an unhelpful message at deploy time.
 *
 * @internal
 */
function dedupeStateMachineTokens(scope, node) {
    const stack = cdk.Stack.of(scope);
    const substitutions = {};
    const keyByToken = new Map();
    // first pass. nothing has been rewritten yet, so any `${` we find came from user input. tokens are spelled
    // `${Token[...]}` themselves, so skip those here and let the second pass give them a placeholder
    const check = (value) => {
        if (typeof value === 'string') {
            if (!cdk.Token.isUnresolved(value) && value.includes('${')) {
                cdk.Annotations.of(scope).addError(`A runner provider value contains "\${", which collides with the state machine definition substitutions: ${JSON.stringify(value.slice(0, 100))}`);
            }
        }
        else if (Array.isArray(value)) {
            value.forEach(check);
        }
        else if (value && typeof value === 'object') {
            for (const [objKey, objValue] of Object.entries(value)) {
                if (objKey.includes('${')) {
                    cdk.Annotations.of(scope).addError(`A runner provider path contains "\${", which collides with the state machine definition substitutions: ${JSON.stringify(objKey.slice(0, 100))}`);
                }
                check(objValue);
            }
        }
    };
    // second pass. key the cache by the resolved intrinsic, so identical imports collapse even when their token
    // strings differ
    const substitute = (value) => {
        if (typeof value === 'string') {
            if (!cdk.Token.isUnresolved(value)) {
                return value;
            }
            const id = JSON.stringify(stack.resolve(value));
            let key = keyByToken.get(id);
            if (!key) {
                key = `__sfnsub_${keyByToken.size}`;
                keyByToken.set(id, key);
                substitutions[key] = value;
            }
            return `\${${key}}`;
        }
        if (Array.isArray(value)) {
            return value.map(substitute);
        }
        if (value && typeof value === 'object') {
            for (const objKey of Object.keys(value)) {
                value[objKey] = substitute(value[objKey]);
            }
        }
        return value;
    };
    check(node);
    substitute(node);
    return substitutions;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBWUEsMENBWUM7QUFPRCxzQ0FTQztBQWtCRCw4Q0FXQztBQThERCw0REE4QkM7QUFlRCw0REEyREM7QUFVRCw4Q0FJQztBQXpQRCx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBQzdCLDZDQUFxRztBQUNyRyxpREFBbUM7QUFJbkM7Ozs7R0FJRztBQUNILFNBQWdCLGVBQWUsQ0FDN0IsWUFBdUYsRUFDdkYsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7SUFFNUQsTUFBTSxhQUFhLEdBQUcsR0FBRyxFQUFFLHVDQUF1QyxDQUFDO0lBQ25FLE1BQU0sUUFBUSxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDdEUsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUNiLDJCQUEyQjtRQUMzQixPQUFPLFFBQXdCLENBQUM7SUFDbEMsQ0FBQztJQUVELE9BQU8sSUFBSSxZQUFZLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFDO0FBQ3JFLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFNBQXlCO0lBQ25GLE1BQU0sYUFBYSxHQUFHLEdBQUcsRUFBRSx1Q0FBdUMsQ0FBQztJQUNuRSxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQ3RFLElBQUksUUFBUSxFQUFFLENBQUM7UUFDYiwyQkFBMkI7UUFDM0IsT0FBTyxRQUFvQixDQUFDO0lBQzlCLENBQUM7SUFFRCxPQUFPLElBQUkscUJBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsYUFBYSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztBQUN6RSxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILElBQVksZ0JBSVg7QUFKRCxXQUFZLGdCQUFnQjtJQUMxQix5RUFBcUQsQ0FBQTtJQUNyRCxxREFBaUMsQ0FBQTtJQUNqQyx1Q0FBbUIsQ0FBQTtBQUNyQixDQUFDLEVBSlcsZ0JBQWdCLGdDQUFoQixnQkFBZ0IsUUFJM0I7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQUMsS0FBZ0IsRUFBRSxJQUFzQjtJQUN4RSxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzdELElBQUksUUFBUSxFQUFFLENBQUM7UUFDYiwyQkFBMkI7UUFDM0IsT0FBTyxRQUEwQixDQUFDO0lBQ3BDLENBQUM7SUFFRCxPQUFPLElBQUksc0JBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsSUFBSSxFQUFFO1FBQ2xELFNBQVMsRUFBRSxzQkFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1FBQ3ZDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87S0FDekMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVEOzs7O0dBSUc7QUFDVSxRQUFBLDRDQUE0QyxHQUFHLElBQUkscUJBQUcsQ0FBQyxlQUFlLENBQUM7SUFDbEYsT0FBTyxFQUFFO1FBQ1Asa0NBQWtDO1FBQ2xDLCtCQUErQjtRQUMvQixnQ0FBZ0M7UUFDaEMsNkJBQTZCO0tBQzlCO0lBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO0NBQ2pCLENBQUMsQ0FBQztBQUVIOzs7O0dBSUc7QUFDVSxRQUFBLGdEQUFnRCxHQUFHLElBQUkscUJBQUcsQ0FBQyxlQUFlLENBQUM7SUFDdEYsT0FBTyxFQUFFO1FBQ1Asa0NBQWtDO1FBQ2xDLCtCQUErQjtRQUMvQixnQ0FBZ0M7UUFDaEMsNkJBQTZCO1FBQzdCLCtCQUErQjtLQUNoQztJQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztDQUNqQixDQUFDLENBQUM7QUFFSDs7OztHQUlHO0FBQ1UsUUFBQSxnREFBZ0QsR0FBRyxJQUFJLHFCQUFHLENBQUMsZUFBZSxDQUFDO0lBQ3RGLE9BQU8sRUFBRTtRQUNQLGtDQUFrQztRQUNsQywrQkFBK0I7UUFDL0IsZ0NBQWdDO1FBQ2hDLDZCQUE2QjtRQUM3QiwrQkFBK0I7UUFDL0IsK0JBQStCO0tBQ2hDO0lBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO0NBQ2pCLENBQUMsQ0FBQztBQUVIOzs7Ozs7Ozs7OztHQVdHO0FBQ0gsU0FBZ0Isd0JBQXdCLENBQUMsVUFBa0I7SUFDekQsSUFBSSxnQkFBZ0IsR0FBYSxFQUFFLENBQUM7SUFFcEMsSUFBSSxDQUFDO1FBQ0gsTUFBTSxJQUFJLEdBQUcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNyQyxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQ3ZCLGtEQUFrRDtZQUNsRCxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQ3pDLGdCQUFnQixHQUFHLEtBQUs7aUJBQ3JCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQztpQkFDOUQsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLENBQUM7aUJBQ3hDLElBQUksRUFBRSxDQUFDLENBQUMsK0JBQStCO1lBRTFDLElBQUksZ0JBQWdCLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBQzNGLENBQUM7UUFDSCxDQUFDO2FBQU0sSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztZQUN6QixxQ0FBcUM7WUFDckMsZ0JBQWdCLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNsQyxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsOERBQThELFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDOUYsQ0FBQztJQUNILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsSUFBSyxLQUErQixDQUFDLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN2RCxNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQzNFLENBQUM7UUFDRCxNQUFNLEtBQUssQ0FBQztJQUNkLENBQUM7SUFFRCxPQUFPLGdCQUFnQixDQUFDO0FBQzFCLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxTQUFnQix3QkFBd0IsQ0FBQyxLQUFnQixFQUFFLElBQVM7SUFDbEUsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbEMsTUFBTSxhQUFhLEdBQTJCLEVBQUUsQ0FBQztJQUNqRCxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUU3QywyR0FBMkc7SUFDM0csaUdBQWlHO0lBQ2pHLE1BQU0sS0FBSyxHQUFHLENBQUMsS0FBVSxFQUFRLEVBQUU7UUFDakMsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM5QixJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUMzRCxHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLENBQ2hDLDJHQUEyRyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FDakosQ0FBQztZQUNKLENBQUM7UUFDSCxDQUFDO2FBQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDaEMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN2QixDQUFDO2FBQU0sSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDOUMsS0FBSyxNQUFNLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDdkQsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQzFCLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsQ0FDaEMsMEdBQTBHLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUNqSixDQUFDO2dCQUNKLENBQUM7Z0JBQ0QsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ2xCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQyxDQUFDO0lBRUYsNEdBQTRHO0lBQzVHLGlCQUFpQjtJQUNqQixNQUFNLFVBQVUsR0FBRyxDQUFDLEtBQVUsRUFBTyxFQUFFO1FBQ3JDLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDOUIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ25DLE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztZQUNELE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ2hELElBQUksR0FBRyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDN0IsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUNULEdBQUcsR0FBRyxZQUFZLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDcEMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLENBQUM7Z0JBQ3hCLGFBQWEsQ0FBQyxHQUFHLENBQUMsR0FBRyxLQUFLLENBQUM7WUFDN0IsQ0FBQztZQUNELE9BQU8sTUFBTSxHQUFHLEdBQUcsQ0FBQztRQUN0QixDQUFDO1FBQ0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsT0FBTyxLQUFLLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQy9CLENBQUM7UUFDRCxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN2QyxLQUFLLE1BQU0sTUFBTSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDeEMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztZQUM1QyxDQUFDO1FBQ0gsQ0FBQztRQUNELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQyxDQUFDO0lBRUYsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ1osVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRWpCLE9BQU8sYUFBYSxDQUFDO0FBQ3ZCLENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQUMsWUFBOEI7SUFDOUQsTUFBTSxDQUFDLEdBQUcsWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ2hELG9HQUFvRztJQUNwRyxPQUFPLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNsQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGF3c19lYzIgYXMgZWMyLCBhd3NfaWFtIGFzIGlhbSwgYXdzX2xhbWJkYSBhcyBsYW1iZGEsIGF3c19sb2dzIGFzIGxvZ3MgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cblxuLyoqXG4gKiBJbml0aWFsaXplIG9yIHJldHVybiBhIHNpbmdsZXRvbiBMYW1iZGEgZnVuY3Rpb24gaW5zdGFuY2UuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW5nbGV0b25MYW1iZGE8RnVuY3Rpb25UeXBlIGV4dGVuZHMgbGFtYmRhLkZ1bmN0aW9uPihcbiAgZnVuY3Rpb25UeXBlOiBuZXcgKHM6IENvbnN0cnVjdCwgaTogc3RyaW5nLCBwPzogbGFtYmRhLkZ1bmN0aW9uT3B0aW9ucykgPT4gRnVuY3Rpb25UeXBlLFxuICBzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGxhbWJkYS5GdW5jdGlvbk9wdGlvbnMpOiBGdW5jdGlvblR5cGUge1xuXG4gIGNvbnN0IGNvbnN0cnVjdE5hbWUgPSBgJHtpZH0tZGNjMDM2YzgtODc2Yi00NTFlLWEyYzEtNTUyZjllMDZlOWUxYDtcbiAgY29uc3QgZXhpc3RpbmcgPSBjZGsuU3RhY2sub2Yoc2NvcGUpLm5vZGUudHJ5RmluZENoaWxkKGNvbnN0cnVjdE5hbWUpO1xuICBpZiAoZXhpc3RpbmcpIHtcbiAgICAvLyBKdXN0IGFzc3VtZSB0aGlzIGlzIHRydWVcbiAgICByZXR1cm4gZXhpc3RpbmcgYXMgRnVuY3Rpb25UeXBlO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBmdW5jdGlvblR5cGUoY2RrLlN0YWNrLm9mKHNjb3BlKSwgY29uc3RydWN0TmFtZSwgcHJvcHMpO1xufVxuXG4vKipcbiAqIEluaXRpYWxpemUgb3IgcmV0dXJuIGEgc2luZ2xldG9uIHJvbGUgaW5zdGFuY2UuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW5nbGV0b25Sb2xlKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGFzc3VtZWRCeTogaWFtLklQcmluY2lwYWwpOiBpYW0uSVJvbGUge1xuICBjb25zdCBjb25zdHJ1Y3ROYW1lID0gYCR7aWR9LWRjYzAzNmM4LTg3NmItNDUxZS1hMmMxLTU1MmY5ZTA2ZTllMWA7XG4gIGNvbnN0IGV4aXN0aW5nID0gY2RrLlN0YWNrLm9mKHNjb3BlKS5ub2RlLnRyeUZpbmRDaGlsZChjb25zdHJ1Y3ROYW1lKTtcbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgLy8gSnVzdCBhc3N1bWUgdGhpcyBpcyB0cnVlXG4gICAgcmV0dXJuIGV4aXN0aW5nIGFzIGlhbS5Sb2xlO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBpYW0uUm9sZShjZGsuU3RhY2sub2Yoc2NvcGUpLCBjb25zdHJ1Y3ROYW1lLCB7IGFzc3VtZWRCeSB9KTtcbn1cblxuLyoqXG4gKiBDZW50cmFsIGxvZyBncm91cCB0eXBlLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZW51bSBTaW5nbGV0b25Mb2dUeXBlIHtcbiAgUlVOTkVSX0lNQUdFX0JVSUxEID0gJ1J1bm5lciBJbWFnZSBCdWlsZCBIZWxwZXJzIExvZycsXG4gIE9SQ0hFU1RSQVRPUiA9ICdPcmNoZXN0cmF0b3IgTG9nJyxcbiAgU0VUVVAgPSAnU2V0dXAgTG9nJyxcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIG9yIHJldHVybiBjZW50cmFsIGxvZyBncm91cCBpbnN0YW5jZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNpbmdsZXRvbkxvZ0dyb3VwKHNjb3BlOiBDb25zdHJ1Y3QsIHR5cGU6IFNpbmdsZXRvbkxvZ1R5cGUpOiBsb2dzLklMb2dHcm91cCB7XG4gIGNvbnN0IGV4aXN0aW5nID0gY2RrLlN0YWNrLm9mKHNjb3BlKS5ub2RlLnRyeUZpbmRDaGlsZCh0eXBlKTtcbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgLy8gSnVzdCBhc3N1bWUgdGhpcyBpcyB0cnVlXG4gICAgcmV0dXJuIGV4aXN0aW5nIGFzIGxvZ3MuSUxvZ0dyb3VwO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBsb2dzLkxvZ0dyb3VwKGNkay5TdGFjay5vZihzY29wZSksIHR5cGUsIHtcbiAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGFic29sdXRlIG1pbmltdW0gcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXIgdG8gd29yay4gVW5saWtlIGBBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlYCwgaXQgZG9lc24ndCBnaXZlIHBlcm1pc3Npb24gdG8gcmVhZCBhbGwgU1NNIHBhcmFtZXRlcnMuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjb25zdCBNSU5JTUFMX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgYWN0aW9uczogW1xuICAgICdzc21tZXNzYWdlczpDcmVhdGVDb250cm9sQ2hhbm5lbCcsXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZURhdGFDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkRhdGFDaGFubmVsJyxcbiAgXSxcbiAgcmVzb3VyY2VzOiBbJyonXSxcbn0pO1xuXG4vKipcbiAqIFRoZSBhYnNvbHV0ZSBtaW5pbXVtIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBTU00gU2Vzc2lvbiBNYW5hZ2VyIG9uIEVDUyB0byB3b3JrLiBVbmxpa2UgYEFtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmVgLCBpdCBkb2Vzbid0IGdpdmUgcGVybWlzc2lvbiB0byByZWFkIGFsbCBTU00gcGFyYW1ldGVycy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IE1JTklNQUxfRUNTX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgYWN0aW9uczogW1xuICAgICdzc21tZXNzYWdlczpDcmVhdGVDb250cm9sQ2hhbm5lbCcsXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZURhdGFDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6T3BlbkRhdGFDaGFubmVsJyxcbiAgICAnczM6R2V0RW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24nLFxuICBdLFxuICByZXNvdXJjZXM6IFsnKiddLFxufSk7XG5cbi8qKlxuICogVGhlIGFic29sdXRlIG1pbmltdW0gcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXIgb24gRUMyIHRvIHdvcmsuIFVubGlrZSBgQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZWAsIGl0IGRvZXNuJ3QgZ2l2ZSBwZXJtaXNzaW9uIHRvIHJlYWQgYWxsIFNTTSBwYXJhbWV0ZXJzLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgTUlOSU1BTF9FQzJfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICBhY3Rpb25zOiBbXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZUNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6Q3JlYXRlRGF0YUNoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuQ29udHJvbENoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuRGF0YUNoYW5uZWwnLFxuICAgICdzMzpHZXRFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgJ3NzbTpVcGRhdGVJbnN0YW5jZUluZm9ybWF0aW9uJyxcbiAgXSxcbiAgcmVzb3VyY2VzOiBbJyonXSxcbn0pO1xuXG4vKipcbiAqIERpc2NvdmVycyBjZXJ0aWZpY2F0ZSBmaWxlcyBmcm9tIGEgZ2l2ZW4gcGF0aCAoZmlsZSBvciBkaXJlY3RvcnkpLlxuICpcbiAqIElmIHRoZSBwYXRoIGlzIGEgZGlyZWN0b3J5LCBmaW5kcyBhbGwgLnBlbSBhbmQgLmNydCBmaWxlcyBpbiBpdC5cbiAqIElmIHRoZSBwYXRoIGlzIGEgZmlsZSwgcmV0dXJucyBpdCBhcyBhIHNpbmdsZSBjZXJ0aWZpY2F0ZSBmaWxlLlxuICpcbiAqIEBwYXJhbSBzb3VyY2VQYXRoIHBhdGggdG8gYSBjZXJ0aWZpY2F0ZSBmaWxlIG9yIGRpcmVjdG9yeSBjb250YWluaW5nIGNlcnRpZmljYXRlIGZpbGVzXG4gKiBAcmV0dXJucyBhcnJheSBvZiBjZXJ0aWZpY2F0ZSBmaWxlIHBhdGhzLCBzb3J0ZWQgYWxwaGFiZXRpY2FsbHlcbiAqIEB0aHJvd3MgRXJyb3IgaWYgcGF0aCBkb2Vzbid0IGV4aXN0LCBpcyBuZWl0aGVyIGZpbGUgbm9yIGRpcmVjdG9yeSwgb3IgZGlyZWN0b3J5IGhhcyBubyBjZXJ0aWZpY2F0ZSBmaWxlc1xuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzY292ZXJDZXJ0aWZpY2F0ZUZpbGVzKHNvdXJjZVBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgbGV0IGNlcnRpZmljYXRlRmlsZXM6IHN0cmluZ1tdID0gW107XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoc291cmNlUGF0aCk7XG4gICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgLy8gUmVhZCBkaXJlY3RvcnkgYW5kIGZpbmQgYWxsIC5wZW0gYW5kIC5jcnQgZmlsZXNcbiAgICAgIGNvbnN0IGZpbGVzID0gZnMucmVhZGRpclN5bmMoc291cmNlUGF0aCk7XG4gICAgICBjZXJ0aWZpY2F0ZUZpbGVzID0gZmlsZXNcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5wZW0nKSB8fCBmaWxlLmVuZHNXaXRoKCcuY3J0JykpXG4gICAgICAgIC5tYXAoZmlsZSA9PiBwYXRoLmpvaW4oc291cmNlUGF0aCwgZmlsZSkpXG4gICAgICAgIC5zb3J0KCk7IC8vIFNvcnQgZm9yIGNvbnNpc3RlbnQgb3JkZXJpbmdcblxuICAgICAgaWYgKGNlcnRpZmljYXRlRmlsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY2VydGlmaWNhdGUgZmlsZXMgKC5wZW0gb3IgLmNydCkgZm91bmQgaW4gZGlyZWN0b3J5OiAke3NvdXJjZVBhdGh9YCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChzdGF0LmlzRmlsZSgpKSB7XG4gICAgICAvLyBTaW5nbGUgZmlsZSAtIGJhY2t3YXJkcyBjb21wYXRpYmxlXG4gICAgICBjZXJ0aWZpY2F0ZUZpbGVzID0gW3NvdXJjZVBhdGhdO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENlcnRpZmljYXRlIHNvdXJjZSBwYXRoIGlzIG5laXRoZXIgYSBmaWxlIG5vciBhIGRpcmVjdG9yeTogJHtzb3VyY2VQYXRofWApO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2VydGlmaWNhdGUgc291cmNlIHBhdGggZG9lcyBub3QgZXhpc3Q6ICR7c291cmNlUGF0aH1gKTtcbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICByZXR1cm4gY2VydGlmaWNhdGVGaWxlcztcbn1cblxuLyoqXG4gKiBEZS1kdXBsaWNhdGUgcmVwZWF0ZWQgQ2xvdWRGb3JtYXRpb24gdG9rZW5zIChzaGFyZWQgc3VibmV0IGlkcywgY2x1c3RlciBBUk5zLCBjcm9zcy1zdGFjayBgRm46OkltcG9ydFZhbHVlYHMsIC4uLikgZm91bmQgaW4gYSBTdGVwIEZ1bmN0aW9uc1xuICogZGVmaW5pdGlvbiBmcmFnbWVudCBpbnRvIGEgYGRlZmluaXRpb25TdWJzdGl0dXRpb25zYCBtYXAuIEVhY2ggZGlzdGluY3QgdG9rZW4gZ2V0cyBhIHNpbmdsZSBgJHtfX3NmbnN1Yl9OfWAgcGxhY2Vob2xkZXIsIHNvIGl0cyBpbnRyaW5zaWMgcmVuZGVyc1xuICogb25jZSBpbiB0aGUgdGVtcGxhdGUgaW5zdGVhZCBvZiBvbmNlIHBlciBvY2N1cnJlbmNlIChlLmcuIG9uY2UgcGVyIHByb3ZpZGVyIHNoYXJpbmcgYSBWUEMpLiBgb2JqYCBpcyBtdXRhdGVkIGluIHBsYWNlLCByZXBsYWNpbmcgZXZlcnkgdG9rZW4gbGVhZlxuICogd2l0aCBpdHMgcGxhY2Vob2xkZXI7IHRoZSByZXR1cm5lZCBtYXAgaXMgbWVhbnQgdG8gYmUgcGFzc2VkIHN0cmFpZ2h0IHRvIGBTdGF0ZU1hY2hpbmVgJ3MgYGRlZmluaXRpb25TdWJzdGl0dXRpb25zYC5cbiAqXG4gKiBUaGlzIGlzIHNhZmUgb25seSBiZWNhdXNlIHRoZSBkZWZpbml0aW9uIGZyYWdtZW50IGNvbnRhaW5zIG5vIG90aGVyIGAkey4uLn1gIHNlcXVlbmNlczogSlNPTmF0YSB1c2VzIGB7JSAlfWAsIGFuZCB0aGUgRUMyIHVzZXIgZGF0YSBlc2NhcGVzIGl0c1xuICogYnJhY2VzIChyZW5kZXJlZCBhcyBgJFxcey4uLlxcfWApLCBzbyBTdGVwIEZ1bmN0aW9ucycgc3Vic3RpdHV0aW9uIGxlYXZlcyBldmVyeXRoaW5nIGJ1dCBvdXIgc3ludGhldGljIHBsYWNlaG9sZGVycyB1bnRvdWNoZWQuIEEgbGl0ZXJhbCBgJHtgXG4gKiByZWFjaGluZyB0aGlzIGZ1bmN0aW9uIGNhbiBvbmx5IGNvbWUgZnJvbSB1c2VyIGlucHV0IChhIHRhZyB2YWx1ZSwgYSBjb25zdHJ1Y3QgaWQsIC4uLiksIHNvIGl0J3MgcmVwb3J0ZWQgYXMgYW4gZXJyb3IgaW5zdGVhZCBvZiBzaWxlbnRseSBwcm9kdWNpbmdcbiAqIGEgZGVmaW5pdGlvbiB0aGF0IFN0ZXAgRnVuY3Rpb25zIHJlamVjdHMgd2l0aCBhbiB1bmhlbHBmdWwgbWVzc2FnZSBhdCBkZXBsb3kgdGltZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZHVwZVN0YXRlTWFjaGluZVRva2VucyhzY29wZTogQ29uc3RydWN0LCBub2RlOiBhbnkpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2Yoc2NvcGUpO1xuICBjb25zdCBzdWJzdGl0dXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGNvbnN0IGtleUJ5VG9rZW4gPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuXG4gIC8vIGZpcnN0IHBhc3MuIG5vdGhpbmcgaGFzIGJlZW4gcmV3cml0dGVuIHlldCwgc28gYW55IGAke2Agd2UgZmluZCBjYW1lIGZyb20gdXNlciBpbnB1dC4gdG9rZW5zIGFyZSBzcGVsbGVkXG4gIC8vIGAke1Rva2VuWy4uLl19YCB0aGVtc2VsdmVzLCBzbyBza2lwIHRob3NlIGhlcmUgYW5kIGxldCB0aGUgc2Vjb25kIHBhc3MgZ2l2ZSB0aGVtIGEgcGxhY2Vob2xkZXJcbiAgY29uc3QgY2hlY2sgPSAodmFsdWU6IGFueSk6IHZvaWQgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBpZiAoIWNkay5Ub2tlbi5pc1VucmVzb2x2ZWQodmFsdWUpICYmIHZhbHVlLmluY2x1ZGVzKCckeycpKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoXG4gICAgICAgICAgYEEgcnVubmVyIHByb3ZpZGVyIHZhbHVlIGNvbnRhaW5zIFwiXFwke1wiLCB3aGljaCBjb2xsaWRlcyB3aXRoIHRoZSBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24gc3Vic3RpdHV0aW9uczogJHtKU09OLnN0cmluZ2lmeSh2YWx1ZS5zbGljZSgwLCAxMDApKX1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHZhbHVlLmZvckVhY2goY2hlY2spO1xuICAgIH0gZWxzZSBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgZm9yIChjb25zdCBbb2JqS2V5LCBvYmpWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUpKSB7XG4gICAgICAgIGlmIChvYmpLZXkuaW5jbHVkZXMoJyR7JykpIHtcbiAgICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZEVycm9yKFxuICAgICAgICAgICAgYEEgcnVubmVyIHByb3ZpZGVyIHBhdGggY29udGFpbnMgXCJcXCR7XCIsIHdoaWNoIGNvbGxpZGVzIHdpdGggdGhlIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbiBzdWJzdGl0dXRpb25zOiAke0pTT04uc3RyaW5naWZ5KG9iaktleS5zbGljZSgwLCAxMDApKX1gLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY2hlY2sob2JqVmFsdWUpO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICAvLyBzZWNvbmQgcGFzcy4ga2V5IHRoZSBjYWNoZSBieSB0aGUgcmVzb2x2ZWQgaW50cmluc2ljLCBzbyBpZGVudGljYWwgaW1wb3J0cyBjb2xsYXBzZSBldmVuIHdoZW4gdGhlaXIgdG9rZW5cbiAgLy8gc3RyaW5ncyBkaWZmZXJcbiAgY29uc3Qgc3Vic3RpdHV0ZSA9ICh2YWx1ZTogYW55KTogYW55ID0+IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgaWYgKCFjZGsuVG9rZW4uaXNVbnJlc29sdmVkKHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICB9XG4gICAgICBjb25zdCBpZCA9IEpTT04uc3RyaW5naWZ5KHN0YWNrLnJlc29sdmUodmFsdWUpKTtcbiAgICAgIGxldCBrZXkgPSBrZXlCeVRva2VuLmdldChpZCk7XG4gICAgICBpZiAoIWtleSkge1xuICAgICAgICBrZXkgPSBgX19zZm5zdWJfJHtrZXlCeVRva2VuLnNpemV9YDtcbiAgICAgICAga2V5QnlUb2tlbi5zZXQoaWQsIGtleSk7XG4gICAgICAgIHN1YnN0aXR1dGlvbnNba2V5XSA9IHZhbHVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGBcXCR7JHtrZXl9fWA7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChzdWJzdGl0dXRlKTtcbiAgICB9XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGZvciAoY29uc3Qgb2JqS2V5IG9mIE9iamVjdC5rZXlzKHZhbHVlKSkge1xuICAgICAgICB2YWx1ZVtvYmpLZXldID0gc3Vic3RpdHV0ZSh2YWx1ZVtvYmpLZXldKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xuXG4gIGNoZWNrKG5vZGUpO1xuICBzdWJzdGl0dXRlKG5vZGUpO1xuXG4gIHJldHVybiBzdWJzdGl0dXRpb25zO1xufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgaW5zdGFuY2UgdHlwZSBoYXMgYW4gTlZJRElBIEdQVS5cbiAqXG4gKiBVc2VzIEFXUyBuYW1pbmcgY29udmVudGlvbjogbW9zdCBOVklESUEgR1BVIGluc3RhbmNlcyB1c2UgJ2cnIChnNGRuLCBnNSwgZzYsIGc5Li4uKSBvciAncCcgKHAzLCBwNGQsIHA1LCBwNi4uLilcbiAqIHByZWZpeCBmb2xsb3dlZCBieSBhIGRpZ2l0LiBFeHBsaWNpdGx5IGV4Y2x1ZGVzIGtub3duIG5vbi1OVklESUEgR1BVIGZhbWlsaWVzIHN1Y2ggYXMgZzRhZCAoQU1EKS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzR3B1SW5zdGFuY2VUeXBlKGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZSk6IGJvb2xlYW4ge1xuICBjb25zdCBzID0gaW5zdGFuY2VUeXBlLnRvU3RyaW5nKCkudG9Mb3dlckNhc2UoKTtcbiAgLy8gTWF0Y2ggR1BVIGluc3RhbmNlIGZhbWlsaWVzIHN0YXJ0aW5nIHdpdGggZy9wICsgZGlnaXQsIGJ1dCBleGNsdWRlIGtub3duIG5vbi1OVklESUEgR1BVIGZhbWlsaWVzLlxuICByZXR1cm4gL15bZ3BdXFxkKyg/IWFkKS8udGVzdChzKTtcbn1cbiJdfQ==