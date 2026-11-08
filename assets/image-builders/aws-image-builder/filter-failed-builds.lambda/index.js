"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/image-builders/aws-image-builder/filter-failed-builds.lambda.ts
var filter_failed_builds_lambda_exports = {};
__export(filter_failed_builds_lambda_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(filter_failed_builds_lambda_exports);
var import_client_sns = require("@aws-sdk/client-sns");
var sns = new import_client_sns.SNSClient();
function summarize(message) {
  if (message.source === "aws.codebuild") {
    const detail = message.detail;
    const info = detail["additional-information"] ?? {};
    const failedPhase = (info.phases ?? []).find((p) => p["phase-status"] && p["phase-status"] !== "SUCCEEDED");
    return {
      subject: `Runner image build failed: ${detail["project-name"]}`,
      text: [
        "Runner image build failed in CodeBuild.",
        "",
        `Project: ${detail["project-name"]}`,
        `Failed phase: ${failedPhase?.["phase-type"] ?? "unknown"}`,
        `Reason: ${failedPhase?.["phase-context"]?.join(" ") || "unknown"}`,
        `Logs: ${info.logs?.["deep-link"] ?? "unknown"}`,
        `Build: ${detail["build-id"]}`
      ].join("\n")
    };
  }
  if (message.state?.status === "FAILED") {
    const region = message.arn.split(":")[3];
    const logGroup = `/aws/imagebuilder/${message.name}`;
    const logGroupLink = encodeURIComponent(encodeURIComponent(logGroup)).replace(/%/g, "$");
    return {
      subject: `Runner image build failed: ${message.name}`,
      text: [
        "Runner image build failed in EC2 Image Builder.",
        "",
        `Recipe: ${message.name} ${message.version}`,
        `Reason: ${message.state.reason ?? "unknown"}`,
        `Logs: https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${logGroupLink}`,
        `Image: ${message.arn}`
      ].join("\n")
    };
  }
  return void 0;
}
async function handler(event) {
  console.log({
    notice: "Received SNS event",
    recordCount: event.Records.length
  });
  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message);
    const summary = summarize(message);
    if (summary) {
      await sns.send(new import_client_sns.PublishCommand({
        TopicArn: process.env.TARGET_TOPIC_ARN,
        Subject: summary.subject.slice(0, 100),
        MessageStructure: "json",
        Message: JSON.stringify({
          default: record.Sns.Message,
          email: `${summary.text}

Runners keep using the last successfully built image until a build succeeds.

Full notification:
${JSON.stringify(message, null, 2)}`
        })
      }));
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
