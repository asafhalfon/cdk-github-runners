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

// src/providers/update-lambda.lambda.ts
var update_lambda_lambda_exports = {};
__export(update_lambda_lambda_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(update_lambda_lambda_exports);
var import_client_lambda = require("@aws-sdk/client-lambda");
var lambda = new import_client_lambda.LambdaClient();
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function handler(event) {
  console.log({
    notice: "Updating Lambda function code from container image",
    lambdaName: event.lambdaName,
    repositoryUri: event.repositoryUri,
    repositoryTag: event.repositoryTag
  });
  while (true) {
    try {
      await lambda.send(new import_client_lambda.UpdateFunctionCodeCommand({
        FunctionName: event.lambdaName,
        ImageUri: `${event.repositoryUri}:${event.repositoryTag}`,
        Publish: true
      }));
      break;
    } catch (e) {
      if (e instanceof import_client_lambda.ResourceConflictException) {
        await sleep(1e4);
      } else {
        throw e;
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
