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
exports.BaseProvider = exports.RUNNER_INPUT = exports.Os = exports.Architecture = exports.RunnerVersion = void 0;
exports.isParameterizedRunnerProvider = isParameterizedRunnerProvider;
exports.providerParam = providerParam;
exports.runnerEnvironment = runnerEnvironment;
exports.runnerDefaultLabels = runnerDefaultLabels;
exports.amiRootDevice = amiRootDevice;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const ami_root_device_function_1 = require("./ami-root-device-function");
const utils_1 = require("../utils");
/**
 * Defines desired GitHub Actions runner version.
 */
class RunnerVersion {
    version;
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.RunnerVersion", version: "0.0.0" };
    /**
     * Use the latest version available at the time the runner provider image is built.
     */
    static latest() {
        return new RunnerVersion('latest');
    }
    /**
     * Use a specific version.
     *
     * @see https://github.com/actions/runner/releases
     *
     * @param version GitHub Runner version
     */
    static specific(version) {
        return new RunnerVersion(version);
    }
    constructor(version) {
        this.version = version;
    }
    /**
     * Check if two versions are the same.
     *
     * @param other version to compare
     */
    is(other) {
        return this.version == other.version;
    }
}
exports.RunnerVersion = RunnerVersion;
/**
 * CPU architecture enum for an image.
 */
class Architecture {
    name;
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.Architecture", version: "0.0.0" };
    /**
     * ARM64
     */
    static ARM64 = Architecture.of('ARM64');
    /**
     * X86_64
     */
    static X86_64 = Architecture.of('X86_64');
    static of(architecture) {
        return new Architecture(architecture);
    }
    constructor(name) {
        this.name = name;
    }
    /**
    * Checks if the given architecture is the same as this one.
    *
    * @param arch architecture to compare
    */
    is(arch) {
        return arch.name == this.name;
    }
    /**
     * Checks if this architecture is in a given list.
     *
     * @param arches architectures to check
     */
    isIn(arches) {
        for (const arch of arches) {
            if (this.is(arch)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Checks if a given EC2 instance type matches this architecture.
     *
     * @param instanceType instance type to check
     */
    instanceTypeMatch(instanceType) {
        if (instanceType.architecture == aws_cdk_lib_1.aws_ec2.InstanceArchitecture.X86_64) {
            return this.is(Architecture.X86_64);
        }
        if (instanceType.architecture == aws_cdk_lib_1.aws_ec2.InstanceArchitecture.ARM_64) {
            return this.is(Architecture.ARM64);
        }
        throw new Error('Unknown instance type architecture');
    }
}
exports.Architecture = Architecture;
/**
 * OS enum for an image.
 */
class Os {
    name;
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.Os", version: "0.0.0" };
    /**
    * Linux
    *
    * @deprecated use {@link LINUX_UBUNTU}, {@link LINUX_UBUNTU_2404}, {@link LINUX_AMAZON_2} or {@link LINUX_AMAZON_2023}
    */
    static LINUX = Os.of('Linux');
    /**
     * Ubuntu Linux
     */
    static LINUX_UBUNTU = Os.of('Ubuntu Linux');
    /**
    * Ubuntu Linux 22.04
    */
    static LINUX_UBUNTU_2204 = Os.of('Ubuntu Linux 22.04');
    /**
     * Ubuntu Linux 24.04
     */
    static LINUX_UBUNTU_2404 = Os.of('Ubuntu Linux 24.04');
    /**
     * Amazon Linux 2
     */
    static LINUX_AMAZON_2 = Os.of('Amazon Linux 2');
    /**
     * Amazon Linux 2023
     */
    static LINUX_AMAZON_2023 = Os.of('Amazon Linux 2023');
    /**
     * @internal
     */
    static _ALL_LINUX_VERSIONS = [Os.LINUX, Os.LINUX_UBUNTU, Os.LINUX_UBUNTU_2204, Os.LINUX_UBUNTU_2404, Os.LINUX_AMAZON_2, Os.LINUX_AMAZON_2023];
    /**
       * @internal
       */
    static _ALL_LINUX_AMAZON_VERSIONS = [Os.LINUX_AMAZON_2, Os.LINUX_AMAZON_2023];
    /**
       * @internal
       */
    static _ALL_LINUX_UBUNTU_VERSIONS = [Os.LINUX_UBUNTU, Os.LINUX_UBUNTU_2204, Os.LINUX_UBUNTU_2404];
    /**
    * Windows
    */
    static WINDOWS = Os.of('Windows');
    static of(os) {
        return new Os(os);
    }
    constructor(name) {
        this.name = name;
    }
    /**
    * Checks if the given OS is the same as this one.
    *
    * @param os OS to compare
    */
    is(os) {
        return os.name == this.name;
    }
    /**
     * Checks if this OS is in a given list.
     *
     * @param oses list of OS to check
     */
    isIn(oses) {
        for (const os of oses) {
            if (this.is(os)) {
                return true;
            }
        }
        return false;
    }
}
exports.Os = Os;
/**
 * Check whether a provider implements the internal contract.
 *
 * instanceof doesn't really work in CDK so duck-type instead.
 *
 * @internal
 */
function isParameterizedRunnerProvider(provider) {
    return '_runnerConfig' in provider;
}
/**
 * Reference paths to the runner values the execution input carries. Written once here so a rename can't quietly
 * miss a fragment.
 *
 * @internal
 */
exports.RUNNER_INPUT = {
    jitConfig: '$.runner.jitConfig',
    name: '$$.Execution.Name',
    labels: '$.labels',
    domain: '$.runner.domain',
    owner: '$.owner',
    repo: '$.repo',
};
/**
 * Reference path to a field of a provider's runner config. Typed on the family's config so renaming a field breaks every fragment that reads it.
 *
 * @internal
 */
function providerParam(key) {
    return `$.providerParams.${key}`;
}
/**
 * Environment variables we pass to the runner. `format` renders one, so
 * each family can use whatever shape its API wants.
 *
 * @internal
 */
function runnerEnvironment(format) {
    return [
        format('RUNNER_JIT_CONFIG', exports.RUNNER_INPUT.jitConfig),
        format('RUNNER_NAME', exports.RUNNER_INPUT.name),
        format('RUNNER_LABEL', exports.RUNNER_INPUT.labels),
        format('GITHUB_DOMAIN', exports.RUNNER_INPUT.domain),
        format('OWNER', exports.RUNNER_INPUT.owner),
        format('REPO', exports.RUNNER_INPUT.repo),
    ];
}
/**
 * Labels config.sh adds on its own unless it gets `--no-default-labels`. JIT runners don't run config.sh, and whoever creates the JIT config
 * doesn't know the OS or architecture, so we have to pass them.
 *
 * @internal
 */
function runnerDefaultLabels(os, architecture, enabled) {
    return enabled ? ['self-hosted', os.is(Os.WINDOWS) ? 'Windows' : 'Linux', architecture.is(Architecture.ARM64) ? 'ARM64' : 'X64'] : [];
}
/**
 * Base class for all providers with common methods used by all providers.
 *
 * @internal
 */
class BaseProvider extends constructs_1.Construct {
    constructor(scope, id, _props) {
        super(scope, id);
        cdk.Tags.of(this).add('GitHubRunners:Provider', this.node.path);
    }
    labelsFromProperties(defaultLabel, propsLabel, propsLabels) {
        if (propsLabels && propsLabel) {
            cdk.Annotations.of(this).addError('Must supply either `label` or `labels` in runner properties, but not both. Try removing the `label` property.');
        }
        if (propsLabels) {
            return propsLabels;
        }
        if (propsLabel) {
            return [propsLabel];
        }
        return [defaultLabel];
    }
}
exports.BaseProvider = BaseProvider;
/**
 * Use custom resource to determine the root device name of a given AMI, Launch Template, or SSM parameter pointing to AMI.
 *
 * TODO move somewhere more common as it's used by both providers and AMI builder now
 *
 * @internal
 */
function amiRootDevice(scope, ami, cacheKey) {
    const crHandler = (0, utils_1.singletonLambda)(ami_root_device_function_1.AmiRootDeviceFunction, scope, 'AMI Root Device Reader', {
        description: 'Custom resource handler that discovers the boot drive device name for a given AMI',
        timeout: cdk.Duration.minutes(1),
        logGroup: (0, utils_1.singletonLogGroup)(scope, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
        loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
        initialPolicy: [
            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                actions: [
                    'ssm:GetParameter',
                    'ec2:DescribeImages',
                    'ec2:DescribeLaunchTemplateVersions',
                    'imagebuilder:GetImage',
                ],
                resources: ['*'],
            }),
        ],
    });
    return new aws_cdk_lib_1.CustomResource(scope, 'AMI Root Device', {
        serviceToken: crHandler.functionArn,
        resourceType: 'Custom::AmiRootDevice',
        properties: {
            Ami: ami ?? '',
            CacheKey: cacheKey,
        },
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tbW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9jb21tb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBb2ZBLHNFQUVDO0FBc0JELHNDQUVDO0FBcURELDhDQVNDO0FBUUQsa0RBRUM7QUErRkQsc0NBMkJDOztBQWh0QkQsaURBQW1DO0FBQ25DLDZDQUErSTtBQUUvSSwyQ0FBZ0U7QUFDaEUseUVBQW1FO0FBQ25FLG9DQUFnRjtBQUVoRjs7R0FFRztBQUNILE1BQWEsYUFBYTtJQW1CTzs7SUFsQi9COztPQUVHO0lBQ0ksTUFBTSxDQUFDLE1BQU07UUFDbEIsT0FBTyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0ksTUFBTSxDQUFDLFFBQVEsQ0FBQyxPQUFlO1FBQ3BDLE9BQU8sSUFBSSxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDcEMsQ0FBQztJQUVELFlBQStCLE9BQWU7UUFBZixZQUFPLEdBQVAsT0FBTyxDQUFRO0lBQzlDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksRUFBRSxDQUFDLEtBQW9CO1FBQzVCLE9BQU8sSUFBSSxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDO0lBQ3ZDLENBQUM7O0FBN0JILHNDQThCQztBQUVEOztHQUVHO0FBQ0gsTUFBYSxZQUFZO0lBZWE7O0lBZHBDOztPQUVHO0lBQ0ksTUFBTSxDQUFVLEtBQUssR0FBRyxZQUFZLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRXhEOztPQUVHO0lBQ0ksTUFBTSxDQUFVLE1BQU0sR0FBRyxZQUFZLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBRWxELE1BQU0sQ0FBQyxFQUFFLENBQUMsWUFBb0I7UUFDcEMsT0FBTyxJQUFJLFlBQVksQ0FBQyxZQUFZLENBQUMs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YXdzX2VjMiBhcyBlYzIsIGF3c19lY3IgYXMgZWNyLCBhd3NfaWFtIGFzIGlhbSwgYXdzX2xhbWJkYSBhcyBsYW1iZGEsIGF3c19sb2dzIGFzIGxvZ3MsIEN1c3RvbVJlc291cmNlLCBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEVic0RldmljZVZvbHVtZVR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IENvbnN0cnVjdCwgSUNvbnN0cnVjdCwgSURlcGVuZGFibGUgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEFtaVJvb3REZXZpY2VGdW5jdGlvbiB9IGZyb20gJy4vYW1pLXJvb3QtZGV2aWNlLWZ1bmN0aW9uJztcbmltcG9ydCB7IHNpbmdsZXRvbkxhbWJkYSwgc2luZ2xldG9uTG9nR3JvdXAsIFNpbmdsZXRvbkxvZ1R5cGUgfSBmcm9tICcuLi91dGlscyc7XG5cbi8qKlxuICogRGVmaW5lcyBkZXNpcmVkIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciB2ZXJzaW9uLlxuICovXG5leHBvcnQgY2xhc3MgUnVubmVyVmVyc2lvbiB7XG4gIC8qKlxuICAgKiBVc2UgdGhlIGxhdGVzdCB2ZXJzaW9uIGF2YWlsYWJsZSBhdCB0aGUgdGltZSB0aGUgcnVubmVyIHByb3ZpZGVyIGltYWdlIGlzIGJ1aWx0LlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBsYXRlc3QoKTogUnVubmVyVmVyc2lvbiB7XG4gICAgcmV0dXJuIG5ldyBSdW5uZXJWZXJzaW9uKCdsYXRlc3QnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVc2UgYSBzcGVjaWZpYyB2ZXJzaW9uLlxuICAgKlxuICAgKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9yZWxlYXNlc1xuICAgKlxuICAgKiBAcGFyYW0gdmVyc2lvbiBHaXRIdWIgUnVubmVyIHZlcnNpb25cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc3BlY2lmaWModmVyc2lvbjogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBSdW5uZXJWZXJzaW9uKHZlcnNpb24pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKHJlYWRvbmx5IHZlcnNpb246IHN0cmluZykge1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHR3byB2ZXJzaW9ucyBhcmUgdGhlIHNhbWUuXG4gICAqXG4gICAqIEBwYXJhbSBvdGhlciB2ZXJzaW9uIHRvIGNvbXBhcmVcbiAgICovXG4gIHB1YmxpYyBpcyhvdGhlcjogUnVubmVyVmVyc2lvbikge1xuICAgIHJldHVybiB0aGlzLnZlcnNpb24gPT0gb3RoZXIudmVyc2lvbjtcbiAgfVxufVxuXG4vKipcbiAqIENQVSBhcmNoaXRlY3R1cmUgZW51bSBmb3IgYW4gaW1hZ2UuXG4gKi9cbmV4cG9ydCBjbGFzcyBBcmNoaXRlY3R1cmUge1xuICAvKipcbiAgICogQVJNNjRcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgQVJNNjQgPSBBcmNoaXRlY3R1cmUub2YoJ0FSTTY0Jyk7XG5cbiAgLyoqXG4gICAqIFg4Nl82NFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBYODZfNjQgPSBBcmNoaXRlY3R1cmUub2YoJ1g4Nl82NCcpO1xuXG4gIHByaXZhdGUgc3RhdGljIG9mKGFyY2hpdGVjdHVyZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBBcmNoaXRlY3R1cmUoYXJjaGl0ZWN0dXJlKTtcbiAgfVxuXG4gIHByaXZhdGUgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IG5hbWU6IHN0cmluZykge1xuICB9XG5cbiAgLyoqXG4gICogQ2hlY2tzIGlmIHRoZSBnaXZlbiBhcmNoaXRlY3R1cmUgaXMgdGhlIHNhbWUgYXMgdGhpcyBvbmUuXG4gICpcbiAgKiBAcGFyYW0gYXJjaCBhcmNoaXRlY3R1cmUgdG8gY29tcGFyZVxuICAqL1xuICBwdWJsaWMgaXMoYXJjaDogQXJjaGl0ZWN0dXJlKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGFyY2gubmFtZSA9PSB0aGlzLm5hbWU7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIHRoaXMgYXJjaGl0ZWN0dXJlIGlzIGluIGEgZ2l2ZW4gbGlzdC5cbiAgICpcbiAgICogQHBhcmFtIGFyY2hlcyBhcmNoaXRlY3R1cmVzIHRvIGNoZWNrXG4gICAqL1xuICBwdWJsaWMgaXNJbihhcmNoZXM6IEFyY2hpdGVjdHVyZVtdKTogYm9vbGVhbiB7XG4gICAgZm9yIChjb25zdCBhcmNoIG9mIGFyY2hlcykge1xuICAgICAgaWYgKHRoaXMuaXMoYXJjaCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBnaXZlbiBFQzIgaW5zdGFuY2UgdHlwZSBtYXRjaGVzIHRoaXMgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBAcGFyYW0gaW5zdGFuY2VUeXBlIGluc3RhbmNlIHR5cGUgdG8gY2hlY2tcbiAgICovXG4gIHB1YmxpYyBpbnN0YW5jZVR5cGVNYXRjaChpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGUpOiBib29sZWFuIHtcbiAgICBpZiAoaW5zdGFuY2VUeXBlLmFyY2hpdGVjdHVyZSA9PSBlYzIuSW5zdGFuY2VBcmNoaXRlY3R1cmUuWDg2XzY0KSB7XG4gICAgICByZXR1cm4gdGhpcy5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KTtcbiAgICB9XG4gICAgaWYgKGluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmUgPT0gZWMyLkluc3RhbmNlQXJjaGl0ZWN0dXJlLkFSTV82NCkge1xuICAgICAgcmV0dXJuIHRoaXMuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGluc3RhbmNlIHR5cGUgYXJjaGl0ZWN0dXJlJyk7XG4gIH1cbn1cblxuLyoqXG4gKiBPUyBlbnVtIGZvciBhbiBpbWFnZS5cbiAqL1xuZXhwb3J0IGNsYXNzIE9zIHtcbiAgLyoqXG4gICogTGludXhcbiAgKlxuICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgTElOVVhfVUJVTlRVfSwge0BsaW5rIExJTlVYX1VCVU5UVV8yNDA0fSwge0BsaW5rIExJTlVYX0FNQVpPTl8yfSBvciB7QGxpbmsgTElOVVhfQU1BWk9OXzIwMjN9XG4gICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVggPSBPcy5vZignTGludXgnKTtcblxuICAvKipcbiAgICogVWJ1bnR1IExpbnV4XG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX1VCVU5UVSA9IE9zLm9mKCdVYnVudHUgTGludXgnKTtcblxuICAvKipcbiAgKiBVYnVudHUgTGludXggMjIuMDRcbiAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9VQlVOVFVfMjIwNCA9IE9zLm9mKCdVYnVudHUgTGludXggMjIuMDQnKTtcblxuICAvKipcbiAgICogVWJ1bnR1IExpbnV4IDI0LjA0XG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX1VCVU5UVV8yNDA0ID0gT3Mub2YoJ1VidW50dSBMaW51eCAyNC4wNCcpO1xuXG4gIC8qKlxuICAgKiBBbWF6b24gTGludXggMlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9BTUFaT05fMiA9IE9zLm9mKCdBbWF6b24gTGludXggMicpO1xuXG4gIC8qKlxuICAgKiBBbWF6b24gTGludXggMjAyM1xuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9BTUFaT05fMjAyMyA9IE9zLm9mKCdBbWF6b24gTGludXggMjAyMycpO1xuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgX0FMTF9MSU5VWF9WRVJTSU9OUyA9XG4gICAgW09zLkxJTlVYLCBPcy5MSU5VWF9VQlVOVFUsIE9zLkxJTlVYX1VCVU5UVV8yMjA0LCBPcy5MSU5VWF9VQlVOVFVfMjQwNCwgT3MuTElOVVhfQU1BWk9OXzIsIE9zLkxJTlVYX0FNQVpPTl8yMDIzXTtcblxuICAvKipcbiAgICAgKiBAaW50ZXJuYWxcbiAgICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBfQUxMX0xJTlVYX0FNQVpPTl9WRVJTSU9OUyA9IFtPcy5MSU5VWF9BTUFaT05fMiwgT3MuTElOVVhfQU1BWk9OXzIwMjNdO1xuXG4gIC8qKlxuICAgICAqIEBpbnRlcm5hbFxuICAgICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IF9BTExfTElOVVhfVUJVTlRVX1ZFUlNJT05TID0gW09zLkxJTlVYX1VCVU5UVSwgT3MuTElOVVhfVUJVTlRVXzIyMDQsIE9zLkxJTlVYX1VCVU5UVV8yNDA0XTtcblxuICAvKipcbiAgKiBXaW5kb3dzXG4gICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgV0lORE9XUyA9IE9zLm9mKCdXaW5kb3dzJyk7XG5cbiAgcHJpdmF0ZSBzdGF0aWMgb2Yob3M6IHN0cmluZykge1xuICAgIHJldHVybiBuZXcgT3Mob3MpO1xuICB9XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihwdWJsaWMgcmVhZG9ubHkgbmFtZTogc3RyaW5nKSB7XG4gIH1cblxuICAvKipcbiAgKiBDaGVja3MgaWYgdGhlIGdpdmVuIE9TIGlzIHRoZSBzYW1lIGFzIHRoaXMgb25lLlxuICAqXG4gICogQHBhcmFtIG9zIE9TIHRvIGNvbXBhcmVcbiAgKi9cbiAgcHVibGljIGlzKG9zOiBPcykge1xuICAgIHJldHVybiBvcy5uYW1lID09IHRoaXMubmFtZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgdGhpcyBPUyBpcyBpbiBhIGdpdmVuIGxpc3QuXG4gICAqXG4gICAqIEBwYXJhbSBvc2VzIGxpc3Qgb2YgT1MgdG8gY2hlY2tcbiAgICovXG4gIHB1YmxpYyBpc0luKG9zZXM6IE9zW10pOiBib29sZWFuIHtcbiAgICBmb3IgKGNvbnN0IG9zIG9mIG9zZXMpIHtcbiAgICAgIGlmICh0aGlzLmlzKG9zKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogRGVzY3JpcHRpb24gb2YgYSBEb2NrZXIgaW1hZ2UgYnVpbHQgYnkge0BsaW5rIFJ1bm5lckltYWdlQnVpbGRlcn0uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUnVubmVySW1hZ2Uge1xuICAvKipcbiAgICogRUNSIHJlcG9zaXRvcnkgY29udGFpbmluZyB0aGUgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBpbWFnZVJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcblxuICAvKipcbiAgICogU3RhdGljIGltYWdlIHRhZyB3aGVyZSB0aGUgaW1hZ2Ugd2lsbCBiZSBwdXNoZWQuXG4gICAqL1xuICByZWFkb25seSBpbWFnZVRhZzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBBcmNoaXRlY3R1cmUgb2YgdGhlIGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmU7XG5cbiAgLyoqXG4gICAqIE9TIHR5cGUgb2YgdGhlIGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgb3M6IE9zO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgd2hlcmUgaW1hZ2UgYnVpbGRzIGFyZSBsb2dnZWQuXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cD86IGxvZ3MuTG9nR3JvdXA7XG5cbiAgLyoqXG4gICAqIEluc3RhbGxlZCBydW5uZXIgdmVyc2lvbi5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgb3BlbiBhIHRpY2tldCBpZiB5b3UgbmVlZCB0aGlzXG4gICAqL1xuICByZWFkb25seSBydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uO1xuXG4gIC8qKlxuICAgKiBBIGRlcGVuZGFibGUgdGhhdCBjYW4gYmUgd2FpdGVkIG9uIHRvIGVuc3VyZSB0aGUgaW1hZ2UgaXMgcmVhZHkuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcmVhZG9ubHkgX2RlcGVuZGFibGU/OiBJRGVwZW5kYWJsZTtcbn1cblxuLyoqXG4gKiBEZXNjcmlwdGlvbiBvZiBhIEFNSSBidWlsdCBieSB7QGxpbmsgUnVubmVySW1hZ2VCdWlsZGVyfS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSdW5uZXJBbWkge1xuICAvKipcbiAgICogTGF1bmNoIHRlbXBsYXRlIHBvaW50aW5nIHRvIHRoZSBsYXRlc3QgQU1JLlxuICAgKi9cbiAgcmVhZG9ubHkgbGF1bmNoVGVtcGxhdGU6IGVjMi5JTGF1bmNoVGVtcGxhdGU7XG5cbiAgLyoqXG4gICAqIEFyY2hpdGVjdHVyZSBvZiB0aGUgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcblxuICAvKipcbiAgICogT1MgdHlwZSBvZiB0aGUgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBvczogT3M7XG5cbiAgLyoqXG4gICAqIExvZyBncm91cCB3aGVyZSBpbWFnZSBidWlsZHMgYXJlIGxvZ2dlZC5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwPzogbG9ncy5Mb2dHcm91cDtcblxuICAvKipcbiAgICogSW5zdGFsbGVkIHJ1bm5lciB2ZXJzaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBvcGVuIGEgdGlja2V0IGlmIHlvdSBuZWVkIHRoaXNcbiAgICovXG4gIHJlYWRvbmx5IHJ1bm5lclZlcnNpb246IFJ1bm5lclZlcnNpb247XG5cbiAgLyoqXG4gICAqIFNldCB0aGlzIHRvIGEgdmFsdWUgdGhhdCBjaGFuZ2VzIHdoZW5ldmVyIHRoZSBBTUkgY2hhbmdlcyAodGhlIEFNSSBpZCBvciBhbnkgdmVyc2lvbiBzdHJpbmcgd29ya3MpLlxuICAgKlxuICAgKiBJdCdzIHVzZWQgdG8ga25vdyB3aGVuIHRoZSBBTUkncyByb290IGRldmljZSBuYW1lIG5lZWRzIHRvIGJlIGxvb2tlZCB1cCBhZ2Fpbi4gSWYgbGVmdCBlbXB0eSwgdGhlIHJvb3RcbiAgICogZGV2aWNlIG5hbWUgaXMgbG9va2VkIHVwIG9uY2UgYW5kIHJldXNlZC4gVGhhdCdzIGZpbmUgYXMgbG9uZyBhcyB0aGUgQU1JJ3Mgcm9vdCBkZXZpY2UgbmV2ZXIgY2hhbmdlcy5cbiAgICpcbiAgICogVGhpcyB2YWx1ZSBtYXkgYmUgdXNlZCBmb3Igb3RoZXIgdGhpbmdzIGluIHRoZSBmdXR1cmUgdGhhdCByZXF1aXJlIGtub3dpbmcgd2hlbiB0aGUgQU1JIGNoYW5nZWQuXG4gICAqL1xuICByZWFkb25seSBjYWNoZUtleT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXRyeSBvcHRpb25zIGZvciBwcm92aWRlcnMuIFRoZSBkZWZhdWx0IGlzIHRvIHJldHJ5IDIxMCB0aW1lcyBmb3IgYSBiaXQgb3ZlciAyNCBob3VycyB3aXRoIGluY3JlYXNpbmcgaW50ZXJ2YWwuXG4gKlxuICogUmV0cmllcyB1c2UgZnVsbCBqaXR0ZXIsIHNvIGV2ZXJ5IHdhaXQgaXMgYSByYW5kb20gdGltZSBiZXR3ZWVuIHplcm8gYW5kIHRoZSBjYWxjdWxhdGVkIGludGVydmFsLiBUaGlzIHNwcmVhZHMgb3V0XG4gKiBydW5uZXJzIHRoYXQgYWxsIGZhaWxlZCBhdCB0aGUgc2FtZSB0aW1lLCBzbyB0aGV5IGRvbid0IGhpdCB0aGUgc2FtZSBtaXNzaW5nIGNhcGFjaXR5IG9yIEFQSSBxdW90YSB0b2dldGhlciBhZ2Fpbi5cbiAqIEl0IGFsc28gbWVhbnMgdGhlIGF2ZXJhZ2Ugd2FpdCBpcyBoYWxmIHRoZSBjYWxjdWxhdGVkIGludGVydmFsLCBhbmQgdGhhdCdzIHdoYXQgdGhlIDI0IGhvdXJzIGFyZSBjYWxjdWxhdGVkIGZyb20uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHJvdmlkZXJSZXRyeU9wdGlvbnMge1xuICAvKipcbiAgICogU2V0IHRvIHRydWUgdG8gcmV0cnkgcHJvdmlkZXIgb24gc3VwcG9ydGVkIGZhaWx1cmVzLiBXaGljaCBmYWlsdXJlcyBnZW5lcmF0ZSBhIHJldHJ5IGRlcGVuZHMgb24gdGhlIHNwZWNpZmljIHByb3ZpZGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSByZXRyeT86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEhvdyBtdWNoIHRpbWUgdG8gd2FpdCBhZnRlciBmaXJzdCByZXRyeWFibGUgZmFpbHVyZS4gVGhpcyBpbnRlcnZhbCB3aWxsIGJlIG11bHRpcGxpZWQgYnkge0BsaW5rIGJhY2tvZmZSYXRlfSBlYWNoIHJldHJ5LCB1cCB0byB7QGxpbmsgbWF4RGVsYXl9LlxuICAgKlxuICAgKiBAZGVmYXVsdCAxIG1pbnV0ZVxuICAgKi9cbiAgcmVhZG9ubHkgaW50ZXJ2YWw/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogTWF4aW11bSB3YWl0IGJldHdlZW4gcmV0cmllcy4gV2l0aG91dCBpdCwgZXhwb25lbnRpYWwgYmFja29mZiBxdWlja2x5IGdyb3dzIHRvIGhvdXJzIGJldHdlZW4gYXR0ZW1wdHMsIHNvIGEgam9iXG4gICAqIGNhbiBlbmQgdXAgd2FpdGluZyBob3VycyBmb3IgYSBydW5uZXIgZXZlbiB0aG91Z2ggY2FwYWNpdHkgY2FtZSBiYWNrIG1pbnV0ZXMgYWZ0ZXIgaXQgZmFpbGVkLlxuICAgKlxuICAgKiBEb24ndCBnbyB0b28gbG93IGVpdGhlci4gQSBsb3dlciBtYXhpbXVtIG5lZWRzIG1vcmUgYXR0ZW1wdHMgdG8gY292ZXIgdGhlIHNhbWUgMjQgaG91cnMsIGFuZCBldmVyeSBhdHRlbXB0IGFkZHNcbiAgICogdG8gdGhlIGV4ZWN1dGlvbiBoaXN0b3J5IHRoYXQgU3RlcCBGdW5jdGlvbnMgY2FwcyBhdCAyNSwwMDAgZXZlbnRzLlxuICAgKlxuICAgKiBAZGVmYXVsdCAxNSBtaW51dGVzXG4gICAqL1xuICByZWFkb25seSBtYXhEZWxheT86IER1cmF0aW9uO1xuXG4gIC8qKlxuICAgKiBIb3cgbWFueSB0aW1lcyB0byByZXRyeS5cbiAgICpcbiAgICogQGRlZmF1bHQgMjEwXG4gICAqL1xuICByZWFkb25seSBtYXhBdHRlbXB0cz86IG51bWJlcjtcblxuICAvKipcbiAgICogTXVsdGlwbGljYXRpb24gZm9yIGhvdyBtdWNoIGxvbmdlciB0aGUgd2FpdCBpbnRlcnZhbCBnZXRzIG9uIGV2ZXJ5IHJldHJ5LlxuICAgKlxuICAgKiBAZGVmYXVsdCAyXG4gICAqL1xuICByZWFkb25seSBiYWNrb2ZmUmF0ZT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDb21tb24gcHJvcGVydGllcyBmb3IgYWxsIHJ1bm5lciBwcm92aWRlcnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUnVubmVyUHJvdmlkZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGRheXMgbG9nIGV2ZW50cyBhcmUga2VwdCBpbiBDbG91ZFdhdGNoIExvZ3MuIFdoZW4gdXBkYXRpbmdcbiAgICogdGhpcyBwcm9wZXJ0eSwgdW5zZXR0aW5nIGl0IGRvZXNuJ3QgcmVtb3ZlIHRoZSBsb2cgcmV0ZW50aW9uIHBvbGljeS4gVG9cbiAgICogcmVtb3ZlIHRoZSByZXRlbnRpb24gcG9saWN5LCBzZXQgdGhlIHZhbHVlIHRvIGBJTkZJTklURWAuXG4gICAqXG4gICAqIEBkZWZhdWx0IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEhcbiAgICovXG4gIHJlYWRvbmx5IGxvZ1JldGVudGlvbj86IGxvZ3MuUmV0ZW50aW9uRGF5cztcblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayByZXRyeU9wdGlvbnN9IG9uIHtAbGluayBHaXRIdWJSdW5uZXJzfSBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSByZXRyeU9wdGlvbnM/OiBQcm92aWRlclJldHJ5T3B0aW9ucztcblxuICAvKipcbiAgICogQWRkIGRlZmF1bHQgbGFiZWxzIGJhc2VkIG9uIE9TIGFuZCBhcmNoaXRlY3R1cmUgb2YgdGhlIHJ1bm5lci4gVGhpcyB3aWxsIHRlbGwgR2l0SHViIFJ1bm5lciB0byBhZGQgZGVmYXVsdCBsYWJlbHMgbGlrZSBgc2VsZi1ob3N0ZWRgLCBgbGludXhgLCBgeDY0YCwgYW5kIGBhcm02NGAuXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEltYWdlIHN0YXR1cyByZXR1cm5lZCBmcm9tIHJ1bm5lciBwcm92aWRlcnMgdG8gYmUgZGlzcGxheWVkIGluIHN0YXR1cy5qc29uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElSdW5uZXJJbWFnZVN0YXR1cyB7XG4gIC8qKlxuICAgKiBJbWFnZSByZXBvc2l0b3J5IHdoZXJlIGltYWdlIGJ1aWxkZXIgcHVzaGVzIHJ1bm5lciBpbWFnZXMuXG4gICAqL1xuICByZWFkb25seSBpbWFnZVJlcG9zaXRvcnk6IHN0cmluZztcblxuICAvKipcbiAgICogVGFnIG9mIGltYWdlIHRoYXQgc2hvdWxkIGJlIHVzZWQuXG4gICAqL1xuICByZWFkb25seSBpbWFnZVRhZzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgbmFtZSBmb3IgdGhlIGltYWdlIGJ1aWxkZXIgd2hlcmUgaGlzdG9yeSBvZiBpbWFnZSBidWlsZHMgY2FuIGJlIGFuYWx5emVkLlxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyTG9nR3JvdXA/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQU1JIHN0YXR1cyByZXR1cm5lZCBmcm9tIHJ1bm5lciBwcm92aWRlcnMgdG8gYmUgZGlzcGxheWVkIGFzIG91dHB1dCBvZiBzdGF0dXMgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVJ1bm5lckFtaVN0YXR1cyB7XG4gIC8qKlxuICAgKiBJZCBvZiBsYXVuY2ggdGVtcGxhdGUgcG9pbnRpbmcgdG8gdGhlIGxhdGVzdCBBTUkgYnVpbHQgYnkgdGhlIEFNSSBidWlsZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGF1bmNoVGVtcGxhdGU6IHN0cmluZztcblxuICAvKipcbiAgICogTG9nIGdyb3VwIG5hbWUgZm9yIHRoZSBBTUkgYnVpbGRlciB3aGVyZSBoaXN0b3J5IG9mIGJ1aWxkcyBjYW4gYmUgYW5hbHl6ZWQuXG4gICAqL1xuICByZWFkb25seSBhbWlCdWlsZGVyTG9nR3JvdXA/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIGZvciBydW5uZXIgaW1hZ2Ugc3RhdHVzIHVzZWQgYnkgc3RhdHVzLmpzb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVJ1bm5lclByb3ZpZGVyU3RhdHVzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBwcm92aWRlciB0eXBlLlxuICAgKi9cbiAgcmVhZG9ubHkgdHlwZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogQ0RLIGNvbnN0cnVjdCBub2RlIHBhdGggZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBjb25zdHJ1Y3RQYXRoPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBWUEMgd2hlcmUgcnVubmVycyB3aWxsIGJlIGxhdW5jaGVkLlxuICAgKi9cbiAgcmVhZG9ubHkgdnBjQXJuPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgYXR0YWNoZWQgdG8gcnVubmVycy5cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFJvbGUgYXR0YWNoZWQgdG8gcnVubmVycy5cbiAgICovXG4gIHJlYWRvbmx5IHJvbGVBcm4/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIERldGFpbHMgYWJvdXQgRG9ja2VyIGltYWdlIHVzZWQgYnkgdGhpcyBydW5uZXIgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBpbWFnZT86IElSdW5uZXJJbWFnZVN0YXR1cztcblxuICAvKipcbiAgICogRGV0YWlscyBhYm91dCBBTUkgdXNlZCBieSB0aGlzIHJ1bm5lciBwcm92aWRlci5cbiAgICovXG4gIHJlYWRvbmx5IGFtaT86IElSdW5uZXJBbWlTdGF0dXM7XG5cbiAgLyoqXG4gICAqIExvZyBncm91cCBmb3IgcnVubmVycy5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEludGVyZmFjZSBmb3IgYWxsIHJ1bm5lciBwcm92aWRlcnMuXG4gKlxuICogVGhpcyBpbnRlcmZhY2UgY2Fubm90IGJlIGltcGxlbWVudGVkIGJ5IGV4dGVybmFsIGNvZGUuIElmIHRoZSBidWlsdC1pbiBwcm92aWRlcnMgZG9uJ3QgY292ZXIgeW91ciB1c2UgY2FzZSwgb3BlbiBhbiBpc3N1ZSBzbyB3ZSBjYW4gZGlzY3VzcyBpdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBlYzIuSUNvbm5lY3RhYmxlLCBpYW0uSUdyYW50YWJsZSwgSUNvbnN0cnVjdCB7XG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBsYWJlbHMgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogVGhlc2UgbGFiZWxzIGFyZSB1c2VkIHRvIGlkZW50aWZ5IHdoaWNoIHByb3ZpZGVyIHNob3VsZCBzcGF3biBhIG5ldyBvbi1kZW1hbmQgcnVubmVyLiBFdmVyeSBqb2Igc2VuZHMgYSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBpdCdzIGxvb2tpbmcgZm9yXG4gICAqIGJhc2VkIG9uIHJ1bnMtb24uIFdlIHVzZSBtYXRjaCB0aGUgbGFiZWxzIGZyb20gdGhlIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlLiBJZiBhbGwgdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZSBhcmUgcHJlc2VudCBpbiB0aGVcbiAgICogam9iJ3MgbGFiZWxzLCB0aGlzIHByb3ZpZGVyIHdpbGwgYmUgY2hvc2VuIGFuZCBzcGF3biBhIG5ldyBydW5uZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgd2hlcmUgcHJvdmlkZWQgcnVubmVycyB3aWxsIHNhdmUgdGhlaXIgbG9ncy5cbiAgICpcbiAgICogTm90ZSB0aGF0IHRoaXMgaXMgbm90IHRoZSBqb2IgbG9nLCBidXQgdGhlIHJ1bm5lciBpdHNlbGYuIEl0IHdpbGwgbm90IGNvbnRhaW4gb3V0cHV0IGZyb20gdGhlIEdpdEh1YiBBY3Rpb24gYnV0IG9ubHkgbWV0YWRhdGEgb24gaXRzIGV4ZWN1dGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwOiBsb2dzLklMb2dHcm91cDtcbn1cblxuLyoqXG4gKiBDb250cmFjdCBiZXR3ZWVuIEdpdEh1YlJ1bm5lcnMgYW5kIGl0cyBwcm92aWRlcnMsIGJvdGggbm9ybWFsIGFuZCBjb21wb3NpdGUuIEl0J3MgaGlkZGVuIGZyb20gdGhlIHB1YmxpYyBBUElcbiAqIGJlY2F1c2UgdGhlIHN0YXRlIG1hY2hpbmUgaGFzIG9uZSBzaGFyZWQgZnJhZ21lbnQgcGVyIHByb3ZpZGVyIGZhbWlseSwgYW5kIHdlIG9ubHkgaW1wbGVtZW50IHRoZSBmYW1pbGllcyBpblxuICogdGhpcyBsaWJyYXJ5LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIElQYXJhbWV0ZXJpemVkUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBJQ29uc3RydWN0IHtcbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuXG4gIC8qKlxuICAgKiBSdW50aW1lIGNvbmZpZ3VyYXRpb24gZm9yIHRoaXMgcHJvdmlkZXIuIFdlIGVtYmVkIGl0IGluIHRoZSBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24gYW5kIHRoZSBmYW1pbHkgZnJhZ21lbnRzXG4gICAqIHJlYWQgaXQgZnJvbSBgJC5wcm92aWRlclBhcmFtc2AuIE11c3QgYmUgSlNPTi1zZXJpYWxpemFibGUsIGJ1dCBjYW4gY29udGFpbiBDbG91ZEZvcm1hdGlvbiB0b2tlbnMuXG4gICAqXG4gICAqIEEgY29uZmlnIGNhbiBjaGFpbiBhbm90aGVyIG9uZSBhdCBgZmFsbGJhY2tgIHRvIHRyeSB3aGVuIGl0IGZhaWxzLCBvciBob2xkIGEgYGRpc3RyaWJ1dGVgIGxpc3Qgb2Ygd2VpZ2h0ZWRcbiAgICogY29uZmlncyB0byBwaWNrIGZyb20uXG4gICAqL1xuICBfcnVubmVyQ29uZmlnKCk6IEFueVJ1bm5lckNvbmZpZztcblxuICAvKipcbiAgICogR3JhbnQgdGhlIHN0YXRlIG1hY2hpbmUgcm9sZSB3aGF0ZXZlciB0aGUgZmFtaWx5IGZyYWdtZW50IG5lZWRzIHRvIHJ1biB0aGlzIHBhcnRpY3VsYXIgcHJvdmlkZXIuXG4gICAqL1xuICBfZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpOiB2b2lkO1xuXG4gIC8qKlxuICAgKiBSZXR1cm4gc3RhdHVzIG9mIHRoZSBydW5uZXIgcHJvdmlkZXIgdG8gYmUgdXNlZCBpbiB0aGUgbWFpbiBzdGF0dXMgZnVuY3Rpb24uIEFsc28gZ2l2ZXMgdGhlIHN0YXR1cyBmdW5jdGlvbiBhbnlcbiAgICogbmVlZGVkIHBlcm1pc3Npb25zIHRvIHF1ZXJ5IHRoZSBEb2NrZXIgaW1hZ2Ugb3IgQU1JLiBDb21wb3NpdGUgcHJvdmlkZXJzIHJldHVybiBvbmUgc3RhdHVzIHBlciBzdWItcHJvdmlkZXIuXG4gICAqL1xuICBfc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZTogaWFtLklHcmFudGFibGUpOiBJUnVubmVyUHJvdmlkZXJTdGF0dXMgfCBJUnVubmVyUHJvdmlkZXJTdGF0dXNbXTtcbn1cblxuLyoqXG4gKiBDaGVjayB3aGV0aGVyIGEgcHJvdmlkZXIgaW1wbGVtZW50cyB0aGUgaW50ZXJuYWwgY29udHJhY3QuXG4gKlxuICogaW5zdGFuY2VvZiBkb2Vzbid0IHJlYWxseSB3b3JrIGluIENESyBzbyBkdWNrLXR5cGUgaW5zdGVhZC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyKHByb3ZpZGVyOiBJQ29uc3RydWN0KTogcHJvdmlkZXIgaXMgSVBhcmFtZXRlcml6ZWRSdW5uZXJQcm92aWRlciB7XG4gIHJldHVybiAnX3J1bm5lckNvbmZpZycgaW4gcHJvdmlkZXI7XG59XG5cbi8qKlxuICogUmVmZXJlbmNlIHBhdGhzIHRvIHRoZSBydW5uZXIgdmFsdWVzIHRoZSBleGVjdXRpb24gaW5wdXQgY2Fycmllcy4gV3JpdHRlbiBvbmNlIGhlcmUgc28gYSByZW5hbWUgY2FuJ3QgcXVpZXRseVxuICogbWlzcyBhIGZyYWdtZW50LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgUlVOTkVSX0lOUFVUID0ge1xuICBqaXRDb25maWc6ICckLnJ1bm5lci5qaXRDb25maWcnLFxuICBuYW1lOiAnJCQuRXhlY3V0aW9uLk5hbWUnLFxuICBsYWJlbHM6ICckLmxhYmVscycsXG4gIGRvbWFpbjogJyQucnVubmVyLmRvbWFpbicsXG4gIG93bmVyOiAnJC5vd25lcicsXG4gIHJlcG86ICckLnJlcG8nLFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiBSZWZlcmVuY2UgcGF0aCB0byBhIGZpZWxkIG9mIGEgcHJvdmlkZXIncyBydW5uZXIgY29uZmlnLiBUeXBlZCBvbiB0aGUgZmFtaWx5J3MgY29uZmlnIHNvIHJlbmFtaW5nIGEgZmllbGQgYnJlYWtzIGV2ZXJ5IGZyYWdtZW50IHRoYXQgcmVhZHMgaXQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm92aWRlclBhcmFtPEM+KGtleToga2V5b2YgQyAmIHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJC5wcm92aWRlclBhcmFtcy4ke2tleX1gO1xufVxuXG4vKipcbiAqIEZpZWxkcyBldmVyeSBydW5uZXIgY29uZmlnIGNhcnJpZXMuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUnVubmVyQ29uZmlnIHtcbiAgLyoqIGZhbWlseSB3aG9zZSBmcmFnbWVudCBydW5zIHRoaXMgY29uZmlnICovXG4gIHJlYWRvbmx5IGZhbWlseTogc3RyaW5nO1xuICAvKiogY29uZmlnIHRvIHRyeSB3aGVuIHRoaXMgb25lIGZhaWxzICovXG4gIHJlYWRvbmx5IGZhbGxiYWNrPzogUnVubmVyQ29uZmlnO1xuICAvKiogcHJvdmlkZXIgdGhhdCBhY3R1YWxseSBydW5zIHRoZSBqb2IsIGZvciB0YWdnaW5nLCB3aGVuIGl0IGlzbid0IGAkLnByb3ZpZGVyYCAqL1xuICByZWFkb25seSBwcm92aWRlcjogc3RyaW5nO1xuICAvKiogcnVubmVyIGdyb3VwIHRoaXMgY29uZmlnIHJlZ2lzdGVycyB3aXRoLCBvciBhbiBlbXB0eSBzdHJpbmcgKi9cbiAgcmVhZG9ubHkgcnVubmVyR3JvdXA6IHN0cmluZztcbiAgLyoqIGxhYmVscyBjb25maWcuc2ggd291bGQgaGF2ZSBhZGRlZCBvbiBpdHMgb3duLCBvciBub3RoaW5nIHdoZW4gdGhlIHByb3ZpZGVyIHR1cm5lZCB0aGVtIG9mZi4gc2VlIHtAbGluayBydW5uZXJEZWZhdWx0TGFiZWxzfSAqL1xuICByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBzdHJpbmdbXTtcbiAgLyoqIHRhZ3MgdGhlIHByb3ZpZGVyIHNldHMgb24gd2hhdGV2ZXIgaXQgY3JlYXRlcywgYmVmb3JlIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFncyBnZXQgbWVyZ2VkIGluICovXG4gIHJlYWRvbmx5IHRhZ3M/OiB7IHJlYWRvbmx5IEtleTogc3RyaW5nOyByZWFkb25seSBWYWx1ZTogc3RyaW5nIH1bXTtcbiAgLyoqIEVDUyB3b24ndCB0YWtlIHRoZSBsYWJlbHMgYXMgdGhleSBjb21lIGluIC0tIG5vIGNvbW1hcywgbm8gcGFyZW50aGVzaXMgLS0gc28gaXRzIGNvbmZpZ3MgYXNrIGZvciBhIGNsZWFuZWQgdXAgbGFiZWxzIHRhZyAqL1xuICByZWFkb25seSBjbGVhbkxhYmVscz86IGJvb2xlYW47XG59XG5cbi8qKlxuICogQSBjb25maWcgdGhhdCBwaWNrcyBvbmUgb2Ygc2V2ZXJhbCB3ZWlnaHRlZCBjb25maWdzIGF0IHJ1bnRpbWUuIENvbXBvc2l0ZSBkaXN0cmlidXRpb24gcHJvdmlkZXJzIHJldHVybiB0aGlzXG4gKiBpbnN0ZWFkIG9mIGEgcnVubmVyIGNvbmZpZyBvZiB0aGVpciBvd24uXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGlzdHJpYnV0ZWRSdW5uZXJDb25maWcge1xuICAvKiogc3VtIG9mIGV2ZXJ5IHdlaWdodCwgc28gYSByYW5kb20gbnVtYmVyIGluIFswLCB0b3RhbFdlaWdodCkgY2FuIGJlIGNvbXBhcmVkIGFnYWluc3QgdGhlIHRocmVzaG9sZHMgKi9cbiAgcmVhZG9ubHkgdG90YWxXZWlnaHQ6IG51bWJlcjtcbiAgLyoqIHJ1bm5pbmcgd2VpZ2h0IHN1bXMsIHBhaXJlZCB3aXRoIHRoZSBjb25maWcgdG8gdXNlIGJlbG93IGVhY2ggb25lICovXG4gIHJlYWRvbmx5IGRpc3RyaWJ1dGU6IHtcbiAgICByZWFkb25seSB0aHJlc2hvbGQ6IG51bWJlcjtcbiAgICByZWFkb25seSBjb25maWc6IEFueVJ1bm5lckNvbmZpZztcbiAgfVtdO1xufVxuXG4vKipcbiAqIEVpdGhlciBraW5kIG9mIGNvbmZpZyB0aGUgc3RhdGUgbWFjaGluZSBjYW4gc2VsZWN0LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgdHlwZSBBbnlSdW5uZXJDb25maWcgPSBSdW5uZXJDb25maWcgfCBEaXN0cmlidXRlZFJ1bm5lckNvbmZpZztcblxuLyoqXG4gKiBFbnZpcm9ubWVudCB2YXJpYWJsZXMgd2UgcGFzcyB0byB0aGUgcnVubmVyLiBgZm9ybWF0YCByZW5kZXJzIG9uZSwgc29cbiAqIGVhY2ggZmFtaWx5IGNhbiB1c2Ugd2hhdGV2ZXIgc2hhcGUgaXRzIEFQSSB3YW50cy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJ1bm5lckVudmlyb25tZW50KGZvcm1hdDogKG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZykgPT4gYW55KTogYW55W10ge1xuICByZXR1cm4gW1xuICAgIGZvcm1hdCgnUlVOTkVSX0pJVF9DT05GSUcnLCBSVU5ORVJfSU5QVVQuaml0Q29uZmlnKSxcbiAgICBmb3JtYXQoJ1JVTk5FUl9OQU1FJywgUlVOTkVSX0lOUFVULm5hbWUpLFxuICAgIGZvcm1hdCgnUlVOTkVSX0xBQkVMJywgUlVOTkVSX0lOUFVULmxhYmVscyksXG4gICAgZm9ybWF0KCdHSVRIVUJfRE9NQUlOJywgUlVOTkVSX0lOUFVULmRvbWFpbiksXG4gICAgZm9ybWF0KCdPV05FUicsIFJVTk5FUl9JTlBVVC5vd25lciksXG4gICAgZm9ybWF0KCdSRVBPJywgUlVOTkVSX0lOUFVULnJlcG8pLFxuICBdO1xufVxuXG4vKipcbiAqIExhYmVscyBjb25maWcuc2ggYWRkcyBvbiBpdHMgb3duIHVubGVzcyBpdCBnZXRzIGAtLW5vLWRlZmF1bHQtbGFiZWxzYC4gSklUIHJ1bm5lcnMgZG9uJ3QgcnVuIGNvbmZpZy5zaCwgYW5kIHdob2V2ZXIgY3JlYXRlcyB0aGUgSklUIGNvbmZpZ1xuICogZG9lc24ndCBrbm93IHRoZSBPUyBvciBhcmNoaXRlY3R1cmUsIHNvIHdlIGhhdmUgdG8gcGFzcyB0aGVtLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gcnVubmVyRGVmYXVsdExhYmVscyhvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLCBlbmFibGVkOiBib29sZWFuKTogc3RyaW5nW10ge1xuICByZXR1cm4gZW5hYmxlZCA/IFsnc2VsZi1ob3N0ZWQnLCBvcy5pcyhPcy5XSU5ET1dTKSA/ICdXaW5kb3dzJyA6ICdMaW51eCcsIGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpID8gJ0FSTTY0JyA6ICdYNjQnXSA6IFtdO1xufVxuXG4vKipcbiAqIEludGVyZmFjZSBmb3IgY29tcG9zaXRlIHJ1bm5lciBwcm92aWRlcnMgdGhhdCBjb21iaW5lIG11bHRpcGxlIHN1Yi1wcm92aWRlcnMuXG4gKiBVbmxpa2UgSVJ1bm5lclByb3ZpZGVyLCBjb21wb3NpdGUgcHJvdmlkZXJzIGRvIG5vdCBoYXZlIGNvbm5lY3Rpb25zLCBncmFudCBjYXBhYmlsaXRpZXMsXG4gKiBvciBsb2cgZ3JvdXBzIGFzIHRoZXkgZGVsZWdhdGUgdG8gdGhlaXIgc3ViLXByb3ZpZGVycy5cbiAqXG4gKiBOb3RlIHRoYXQgdGhpcyBpbnRlcmZhY2UgY2Fubm90IGJlIGltcGxlbWVudGVkIGJ5IGV4dGVybmFsIGNvZGUuIFVzZSB7QGxpbmsgQ29tcG9zaXRlUHJvdmlkZXJ9IGZhY3RvcnkgbWV0aG9kcy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQ29tcG9zaXRlUHJvdmlkZXIgZXh0ZW5kcyBJQ29uc3RydWN0IHtcbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgdXNlIG1hdGNoIHRoZSBsYWJlbHMgZnJvbSB0aGUgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUuIElmIGFsbCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlIGFyZSBwcmVzZW50IGluIHRoZVxuICAgKiBqb2IncyBsYWJlbHMsIHRoaXMgcHJvdmlkZXIgd2lsbCBiZSBjaG9zZW4gYW5kIHNwYXduIGEgbmV3IHJ1bm5lci5cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEFsbCBzdWItcHJvdmlkZXJzIGNvbnRhaW5lZCBpbiB0aGlzIGNvbXBvc2l0ZSBwcm92aWRlci5cbiAgICogVGhpcyBpcyB1c2VkIHRvIGV4dHJhY3QgcHJvdmlkZXJzIGZvciBtZXRyaWMgZmlsdGVycyBhbmQgb3RoZXIgb3BlcmF0aW9ucy5cbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVyczogSVJ1bm5lclByb3ZpZGVyW107XG59XG5cbi8qKlxuICogU3RvcmFnZSBvcHRpb25zIGZvciB0aGUgcnVubmVyIGluc3RhbmNlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0b3JhZ2VPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSBFQlMgdm9sdW1lIHR5cGVcbiAgICogQHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTRUMyL2xhdGVzdC9Vc2VyR3VpZGUvRUJTVm9sdW1lVHlwZXMuaHRtbFxuICAgKlxuICAgKiBAZGVmYXVsdCBgRWJzRGV2aWNlVm9sdW1lVHlwZS5HUDJgXG4gICAqL1xuICByZWFkb25seSB2b2x1bWVUeXBlPzogRWJzRGV2aWNlVm9sdW1lVHlwZTtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBJL08gb3BlcmF0aW9ucyBwZXIgc2Vjb25kIChJT1BTKSB0byBwcm92aXNpb24gZm9yIHRoZSB2b2x1bWUuXG4gICAqXG4gICAqIE11c3Qgb25seSBiZSBzZXQgZm9yIGB2b2x1bWVUeXBlYDogYEVic0RldmljZVZvbHVtZVR5cGUuSU8xYFxuICAgKlxuICAgKiBUaGUgbWF4aW11bSByYXRpbyBvZiBJT1BTIHRvIHZvbHVtZSBzaXplIChpbiBHaUIpIGlzIDUwOjEsIHNvIGZvciA1LDAwMCBwcm92aXNpb25lZCBJT1BTLFxuICAgKiB5b3UgbmVlZCBhdCBsZWFzdCAxMDAgR2lCIHN0b3JhZ2Ugb24gdGhlIHZvbHVtZS5cbiAgICpcbiAgICogQHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTRUMyL2xhdGVzdC9Vc2VyR3VpZGUvRUJTVm9sdW1lVHlwZXMuaHRtbFxuICAgKlxuICAgKiBAZGVmYXVsdCAtIG5vbmUsIHJlcXVpcmVkIGZvciBgRWJzRGV2aWNlVm9sdW1lVHlwZS5JTzFgXG4gICAqL1xuICByZWFkb25seSBpb3BzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgdGhyb3VnaHB1dCB0aGF0IHRoZSB2b2x1bWUgc3VwcG9ydHMsIGluIE1pQi9zXG4gICAqIFRha2VzIGEgbWluaW11bSBvZiAxMjUgYW5kIG1heGltdW0gb2YgMTAwMC5cbiAgICogQHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS9hd3MtcmVzb3VyY2UtZWMyLXZvbHVtZS5odG1sI2Nmbi1lYzItdm9sdW1lLXRocm91Z2hwdXRcbiAgICogQGRlZmF1bHQgLSAxMjUgTWlCL3MuIE9ubHkgdmFsaWQgb24gZ3AzIHZvbHVtZXMuXG4gICAqL1xuICByZWFkb25seSB0aHJvdWdocHV0PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGFsbCBwcm92aWRlcnMgd2l0aCBjb21tb24gbWV0aG9kcyB1c2VkIGJ5IGFsbCBwcm92aWRlcnMuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlUHJvdmlkZXIgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwcm90ZWN0ZWQgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgX3Byb3BzPzogUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0dpdEh1YlJ1bm5lcnM6UHJvdmlkZXInLCB0aGlzLm5vZGUucGF0aCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgbGFiZWxzRnJvbVByb3BlcnRpZXMoZGVmYXVsdExhYmVsOiBzdHJpbmcsIHByb3BzTGFiZWw6IHN0cmluZyB8IHVuZGVmaW5lZCwgcHJvcHNMYWJlbHM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkKTogc3RyaW5nW10ge1xuICAgIGlmIChwcm9wc0xhYmVscyAmJiBwcm9wc0xhYmVsKSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoJ011c3Qgc3VwcGx5IGVpdGhlciBgbGFiZWxgIG9yIGBsYWJlbHNgIGluIHJ1bm5lciBwcm9wZXJ0aWVzLCBidXQgbm90IGJvdGguIFRyeSByZW1vdmluZyB0aGUgYGxhYmVsYCBwcm9wZXJ0eS4nKTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHNMYWJlbHMpIHtcbiAgICAgIHJldHVybiBwcm9wc0xhYmVscztcbiAgICB9XG4gICAgaWYgKHByb3BzTGFiZWwpIHtcbiAgICAgIHJldHVybiBbcHJvcHNMYWJlbF07XG4gICAgfVxuICAgIHJldHVybiBbZGVmYXVsdExhYmVsXTtcbiAgfVxufVxuXG4vKipcbiAqIFVzZSBjdXN0b20gcmVzb3VyY2UgdG8gZGV0ZXJtaW5lIHRoZSByb290IGRldmljZSBuYW1lIG9mIGEgZ2l2ZW4gQU1JLCBMYXVuY2ggVGVtcGxhdGUsIG9yIFNTTSBwYXJhbWV0ZXIgcG9pbnRpbmcgdG8gQU1JLlxuICpcbiAqIFRPRE8gbW92ZSBzb21ld2hlcmUgbW9yZSBjb21tb24gYXMgaXQncyB1c2VkIGJ5IGJvdGggcHJvdmlkZXJzIGFuZCBBTUkgYnVpbGRlciBub3dcbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFtaVJvb3REZXZpY2Uoc2NvcGU6IENvbnN0cnVjdCwgYW1pPzogc3RyaW5nLCBjYWNoZUtleT86IHN0cmluZykge1xuICBjb25zdCBjckhhbmRsZXIgPSBzaW5nbGV0b25MYW1iZGEoQW1pUm9vdERldmljZUZ1bmN0aW9uLCBzY29wZSwgJ0FNSSBSb290IERldmljZSBSZWFkZXInLCB7XG4gICAgZGVzY3JpcHRpb246ICdDdXN0b20gcmVzb3VyY2UgaGFuZGxlciB0aGF0IGRpc2NvdmVycyB0aGUgYm9vdCBkcml2ZSBkZXZpY2UgbmFtZSBmb3IgYSBnaXZlbiBBTUknLFxuICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cChzY29wZSwgU2luZ2xldG9uTG9nVHlwZS5SVU5ORVJfSU1BR0VfQlVJTEQpLFxuICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgaW5pdGlhbFBvbGljeTogW1xuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXInLFxuICAgICAgICAgICdlYzI6RGVzY3JpYmVJbWFnZXMnLFxuICAgICAgICAgICdlYzI6RGVzY3JpYmVMYXVuY2hUZW1wbGF0ZVZlcnNpb25zJyxcbiAgICAgICAgICAnaW1hZ2VidWlsZGVyOkdldEltYWdlJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pLFxuICAgIF0sXG4gIH0pO1xuXG4gIHJldHVybiBuZXcgQ3VzdG9tUmVzb3VyY2Uoc2NvcGUsICdBTUkgUm9vdCBEZXZpY2UnLCB7XG4gICAgc2VydmljZVRva2VuOiBjckhhbmRsZXIuZnVuY3Rpb25Bcm4sXG4gICAgcmVzb3VyY2VUeXBlOiAnQ3VzdG9tOjpBbWlSb290RGV2aWNlJyxcbiAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICBBbWk6IGFtaSA/PyAnJyxcbiAgICAgIENhY2hlS2V5OiBjYWNoZUtleSxcbiAgICB9LFxuICB9KTtcbn1cblxuIl19