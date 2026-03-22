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
async function handler(event) {
  console.log({
    notice: "Received SNS event",
    recordCount: event.Records.length
  });
  for (const record of event.Records) {
    let message = JSON.parse(record.Sns.Message);
    if (message.state.status === "FAILED") {
      await sns.send(new import_client_sns.PublishCommand({
        TopicArn: process.env.TARGET_TOPIC_ARN,
        Message: record.Sns.Message
      }));
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
