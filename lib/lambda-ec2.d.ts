/**
 * Terminate any instance still running for a given runner.
 *
 * EC2 runners terminate themselves by calling `poweroff` at the end of their user data script, with `InstanceInitiatedShutdownBehavior=terminate`
 * turning that into a termination. When the user data script never runs (e.g. IMDS not serving it at boot, the OOM killer taking the shell, a wedged
 * `poweroff`) nothing else in the stack cleans the instance up, and it runs until a human notices it.
 *
 * Instances are found by {@link ReservedTags.RUNNER} and {@link ReservedTags.STACK}. The tags have reserved prefix and contains the step function
 * execution name which also matches the runner name on GitHub Actions. Step function execution names are unique for 90 days and runner names are also
 * unique within their registration scope. This allows us to only terminate instances that were launched by us for this specific runner.
 *
 * Call this only from places that already know the runner is finished with like the step function's failure path, or the idle reaper once it has
 * decided a runner is done. Never call it while a runner may still be working. We have no way to tell a busy instance apart from an idle or broken
 * instance.
 *
 * Best effort: a failure is logged and swallowed, because the callers are cleanup paths whose own failure would mask the error that got us there. An
 * instance we miss is an instance that would have been missed anyway before this existed.
 *
 * @param runnerName runner name, which is also the step function execution name
 * @returns ids of the instances we asked to terminate
 *
 * @internal
 */
export declare function terminateRunnerInstances(runnerName: string): Promise<string[]>;
