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

// src/image-builders/build-image.lambda.ts
var build_image_lambda_exports = {};
__export(build_image_lambda_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(build_image_lambda_exports);
var import_client_codebuild = require("@aws-sdk/client-codebuild");

// src/lambda-helpers.ts
var import_client_secrets_manager = require("@aws-sdk/client-secrets-manager");
var sm = new import_client_secrets_manager.SecretsManagerClient();
async function customResourceRespond(event, responseStatus, reason, physicalResourceId, data) {
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: data
  });
  console.log({
    notice: "Responding to CloudFormation custom resource",
    status: responseStatus,
    reason,
    physicalResourceId,
    responseBody
  });
  const parsedUrl = require("url").parse(event.ResponseURL);
  const requestOptions = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.path,
    method: "PUT",
    headers: {
      "content-type": "",
      "content-length": responseBody.length
    }
  };
  return new Promise((resolve, reject) => {
    try {
      const request = require("https").request(requestOptions, resolve);
      request.on("error", reject);
      request.write(responseBody);
      request.end();
    } catch (e) {
      reject(e);
    }
  });
}

// src/image-builders/build-image.lambda.ts
var codebuild = new import_client_codebuild.CodeBuildClient();
async function handler(event, context) {
  try {
    console.log({
      notice: "CloudFormation custom resource request",
      ...event,
      ResponseURL: "..."
    });
    const props = event.ResourceProperties;
    switch (event.RequestType) {
      case "Create":
      case "Update":
        console.log({
          notice: "Starting CodeBuild project",
          projectName: props.ProjectName,
          repoName: props.RepoName
        });
        const cbRes = await codebuild.send(new import_client_codebuild.StartBuildCommand({
          projectName: props.ProjectName,
          environmentVariablesOverride: [
            {
              type: "PLAINTEXT",
              name: "WAIT_HANDLE",
              value: props.WaitHandle
            }
          ]
        }));
        await customResourceRespond(event, "SUCCESS", "OK", cbRes.build?.id ?? "build", {});
        break;
      case "Delete":
        await customResourceRespond(event, "SUCCESS", "OK", event.PhysicalResourceId, {});
        break;
    }
  } catch (e) {
    console.error({
      notice: "Failed to start CodeBuild project",
      error: e
    });
    await customResourceRespond(event, "FAILED", e.message || "Internal Error", context.logStreamName, {});
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
