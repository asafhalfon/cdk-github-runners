"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDERS_PATH = exports.GITHUB_PRIVATE_KEY_PLACEHOLDER = exports.ReservedTags = exports.WARM_RUNNER_JOB_ID = exports.MAX_RUNNER_NAME_LENGTH = void 0;
exports.labelsMatch = labelsMatch;
/**
 * Maximum length of a runner name. We use the runner name as the step function execution name which is limited to 80 characters.
 * But GitHub runner names are limited to 64 characters, so we use that as the maximum length for the runner name.
 *
 * @internal
 */
exports.MAX_RUNNER_NAME_LENGTH = 64;
/**
 * Job id used for warm runners, which aren't started for any job in particular.
 *
 * @internal
 */
exports.WARM_RUNNER_JOB_ID = -1;
/**
 * @internal
 */
var ReservedTags;
(function (ReservedTags) {
    /**
     * Common prefix for all tags we use.
     */
    ReservedTags["PREFIX"] = "GitHubRunners:";
    /**
     * Tag holding the CloudFormation stack name. Helps limit IAM permissions to just resources launched/created by our stack.
     */
    ReservedTags["STACK"] = "GitHubRunners:Stack";
    /**
     * Tag holding the provider name.
     */
    ReservedTags["PROVIDER"] = "GitHubRunners:Provider";
    /**
     * Tag holding the runner labels.
     */
    ReservedTags["LABELS"] = "GitHubRunners:Labels";
    /**
     * Tag holding the runner name, which is also the step function execution name. One execution can launch many instances over its retries and subnet
     * fallbacks, and they all carry the same value.
     */
    ReservedTags["RUNNER"] = "GitHubRunners:Runner";
    /**
     * Tag holding the GitHub owner name (e.g. CloudSnorkel/cdk-github-runners).
     */
    ReservedTags["REPO"] = "GitHubRunners:Repo";
})(ReservedTags || (exports.ReservedTags = ReservedTags = {}));
/**
 * Private key secret value we deploy with. The user is meant to replace it with a real key, and a runner that gets
 * this far with the placeholder still in place was never set up.
 *
 * @internal
 */
exports.GITHUB_PRIVATE_KEY_PLACEHOLDER = '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----';
/**
 * Path of the providers file in the webhook handler layer. It's a layer and not an environment variable because all
 * environment variables of a function are limited to 4kb together, and users with many providers go over that.
 *
 * @internal
 */
exports.PROVIDERS_PATH = '/opt/providers.json';
/**
 * Can a runner with these labels run a job asking for these labels? Every label the job requires must be on the runner.
 *
 * @internal
 */
function labelsMatch(jobLabels, runnerLabels) {
    const runnerLabelsLowerCase = runnerLabels.map((label) => label.toLowerCase());
    return jobLabels.every(label => label.toLowerCase() == 'self-hosted' || runnerLabelsLowerCase.includes(label.toLowerCase()));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWNvbW1vbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9sYW1iZGEtY29tbW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQXdFQSxrQ0FHQztBQTNFRDs7Ozs7R0FLRztBQUNVLFFBQUEsc0JBQXNCLEdBQUcsRUFBRSxDQUFDO0FBRXpDOzs7O0dBSUc7QUFDVSxRQUFBLGtCQUFrQixHQUFHLENBQUMsQ0FBQyxDQUFDO0FBRXJDOztHQUVHO0FBQ0gsSUFBWSxZQStCWDtBQS9CRCxXQUFZLFlBQVk7SUFDdEI7O09BRUc7SUFDSCx5Q0FBeUIsQ0FBQTtJQUV6Qjs7T0FFRztJQUNILDZDQUF3QixDQUFBO0lBRXhCOztPQUVHO0lBQ0gsbURBQThCLENBQUE7SUFFOUI7O09BRUc7SUFDSCwrQ0FBMEIsQ0FBQTtJQUUxQjs7O09BR0c7SUFDSCwrQ0FBMEIsQ0FBQTtJQUUxQjs7T0FFRztJQUNILDJDQUFzQixDQUFBO0FBQ3hCLENBQUMsRUEvQlcsWUFBWSw0QkFBWixZQUFZLFFBK0J2QjtBQUVEOzs7OztHQUtHO0FBQ1UsUUFBQSw4QkFBOEIsR0FBRyxxRUFBcUUsQ0FBQztBQUVwSDs7Ozs7R0FLRztBQUNVLFFBQUEsY0FBYyxHQUFHLHFCQUFxQixDQUFDO0FBRXBEOzs7O0dBSUc7QUFDSCxTQUFnQixXQUFXLENBQUMsU0FBbUIsRUFBRSxZQUFzQjtJQUNyRSxNQUFNLHFCQUFxQixHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO0lBQy9FLE9BQU8sU0FBUyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsSUFBSSxhQUFhLElBQUkscUJBQXFCLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDL0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTWF4aW11bSBsZW5ndGggb2YgYSBydW5uZXIgbmFtZS4gV2UgdXNlIHRoZSBydW5uZXIgbmFtZSBhcyB0aGUgc3RlcCBmdW5jdGlvbiBleGVjdXRpb24gbmFtZSB3aGljaCBpcyBsaW1pdGVkIHRvIDgwIGNoYXJhY3RlcnMuXG4gKiBCdXQgR2l0SHViIHJ1bm5lciBuYW1lcyBhcmUgbGltaXRlZCB0byA2NCBjaGFyYWN0ZXJzLCBzbyB3ZSB1c2UgdGhhdCBhcyB0aGUgbWF4aW11bSBsZW5ndGggZm9yIHRoZSBydW5uZXIgbmFtZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IE1BWF9SVU5ORVJfTkFNRV9MRU5HVEggPSA2NDtcblxuLyoqXG4gKiBKb2IgaWQgdXNlZCBmb3Igd2FybSBydW5uZXJzLCB3aGljaCBhcmVuJ3Qgc3RhcnRlZCBmb3IgYW55IGpvYiBpbiBwYXJ0aWN1bGFyLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgV0FSTV9SVU5ORVJfSk9CX0lEID0gLTE7XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBlbnVtIFJlc2VydmVkVGFncyB7XG4gIC8qKlxuICAgKiBDb21tb24gcHJlZml4IGZvciBhbGwgdGFncyB3ZSB1c2UuXG4gICAqL1xuICBQUkVGSVggPSAnR2l0SHViUnVubmVyczonLFxuXG4gIC8qKlxuICAgKiBUYWcgaG9sZGluZyB0aGUgQ2xvdWRGb3JtYXRpb24gc3RhY2sgbmFtZS4gSGVscHMgbGltaXQgSUFNIHBlcm1pc3Npb25zIHRvIGp1c3QgcmVzb3VyY2VzIGxhdW5jaGVkL2NyZWF0ZWQgYnkgb3VyIHN0YWNrLlxuICAgKi9cbiAgU1RBQ0sgPSBgJHtQUkVGSVh9U3RhY2tgLFxuXG4gIC8qKlxuICAgKiBUYWcgaG9sZGluZyB0aGUgcHJvdmlkZXIgbmFtZS5cbiAgICovXG4gIFBST1ZJREVSID0gYCR7UFJFRklYfVByb3ZpZGVyYCxcblxuICAvKipcbiAgICogVGFnIGhvbGRpbmcgdGhlIHJ1bm5lciBsYWJlbHMuXG4gICAqL1xuICBMQUJFTFMgPSBgJHtQUkVGSVh9TGFiZWxzYCxcblxuICAvKipcbiAgICogVGFnIGhvbGRpbmcgdGhlIHJ1bm5lciBuYW1lLCB3aGljaCBpcyBhbHNvIHRoZSBzdGVwIGZ1bmN0aW9uIGV4ZWN1dGlvbiBuYW1lLiBPbmUgZXhlY3V0aW9uIGNhbiBsYXVuY2ggbWFueSBpbnN0YW5jZXMgb3ZlciBpdHMgcmV0cmllcyBhbmQgc3VibmV0XG4gICAqIGZhbGxiYWNrcywgYW5kIHRoZXkgYWxsIGNhcnJ5IHRoZSBzYW1lIHZhbHVlLlxuICAgKi9cbiAgUlVOTkVSID0gYCR7UFJFRklYfVJ1bm5lcmAsXG5cbiAgLyoqXG4gICAqIFRhZyBob2xkaW5nIHRoZSBHaXRIdWIgb3duZXIgbmFtZSAoZS5nLiBDbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzKS5cbiAgICovXG4gIFJFUE8gPSBgJHtQUkVGSVh9UmVwb2AsXG59XG5cbi8qKlxuICogUHJpdmF0ZSBrZXkgc2VjcmV0IHZhbHVlIHdlIGRlcGxveSB3aXRoLiBUaGUgdXNlciBpcyBtZWFudCB0byByZXBsYWNlIGl0IHdpdGggYSByZWFsIGtleSwgYW5kIGEgcnVubmVyIHRoYXQgZ2V0c1xuICogdGhpcyBmYXIgd2l0aCB0aGUgcGxhY2Vob2xkZXIgc3RpbGwgaW4gcGxhY2Ugd2FzIG5ldmVyIHNldCB1cC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IEdJVEhVQl9QUklWQVRFX0tFWV9QTEFDRUhPTERFUiA9ICctLS0tLUJFR0lOIFJTQSBQUklWQVRFIEtFWS0tLS0tXFxuLi4uXFxuLS0tLS1FTkQgUlNBIFBSSVZBVEUgS0VZLS0tLS0nO1xuXG4vKipcbiAqIFBhdGggb2YgdGhlIHByb3ZpZGVycyBmaWxlIGluIHRoZSB3ZWJob29rIGhhbmRsZXIgbGF5ZXIuIEl0J3MgYSBsYXllciBhbmQgbm90IGFuIGVudmlyb25tZW50IHZhcmlhYmxlIGJlY2F1c2UgYWxsXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZXMgb2YgYSBmdW5jdGlvbiBhcmUgbGltaXRlZCB0byA0a2IgdG9nZXRoZXIsIGFuZCB1c2VycyB3aXRoIG1hbnkgcHJvdmlkZXJzIGdvIG92ZXIgdGhhdC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IFBST1ZJREVSU19QQVRIID0gJy9vcHQvcHJvdmlkZXJzLmpzb24nO1xuXG4vKipcbiAqIENhbiBhIHJ1bm5lciB3aXRoIHRoZXNlIGxhYmVscyBydW4gYSBqb2IgYXNraW5nIGZvciB0aGVzZSBsYWJlbHM/IEV2ZXJ5IGxhYmVsIHRoZSBqb2IgcmVxdWlyZXMgbXVzdCBiZSBvbiB0aGUgcnVubmVyLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gbGFiZWxzTWF0Y2goam9iTGFiZWxzOiBzdHJpbmdbXSwgcnVubmVyTGFiZWxzOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBydW5uZXJMYWJlbHNMb3dlckNhc2UgPSBydW5uZXJMYWJlbHMubWFwKChsYWJlbCkgPT4gbGFiZWwudG9Mb3dlckNhc2UoKSk7XG4gIHJldHVybiBqb2JMYWJlbHMuZXZlcnkobGFiZWwgPT4gbGFiZWwudG9Mb3dlckNhc2UoKSA9PSAnc2VsZi1ob3N0ZWQnIHx8IHJ1bm5lckxhYmVsc0xvd2VyQ2FzZS5pbmNsdWRlcyhsYWJlbC50b0xvd2VyQ2FzZSgpKSk7XG59XG5cbi8qKlxuICogSW5wdXQgZm9yIHRoZSBydW5uZXIgb3JjaGVzdHJhdG9yIHN0ZXAgZnVuY3Rpb24uIFJlYWQgYmFjayBmcm9tIHRoZSBzdGVwIGZ1bmN0aW9uIGl0c2VsZiB3aGVuIGEgcnVubmVyIG5lZWRzXG4gKiByZXBsYWNpbmcsIHNvIGl0IG5ldmVyIGhhcyB0byBiZSBzdG9yZWQgYW55d2hlcmUgZWxzZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBPcmNoZXN0cmF0b3JJbnB1dCB7XG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG86IHN0cmluZztcbiAgcmVhZG9ubHkgam9iSWQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgam9iVXJsOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGluc3RhbGxhdGlvbklkOiBudW1iZXI7XG4gIHJlYWRvbmx5IGpvYkxhYmVsczogc3RyaW5nO1xuICByZWFkb25seSBwcm92aWRlcjogc3RyaW5nO1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZztcbiAgcmVhZG9ubHkgbWF4SWRsZVNlY29uZHM6IG51bWJlcjtcbn1cbiJdfQ==