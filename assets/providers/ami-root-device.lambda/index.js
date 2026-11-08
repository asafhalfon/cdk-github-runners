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

// src/providers/ami-root-device.lambda.ts
var ami_root_device_lambda_exports = {};
__export(ami_root_device_lambda_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(ami_root_device_lambda_exports);
var import_client_ec2 = require("@aws-sdk/client-ec2");
var import_client_imagebuilder = require("@aws-sdk/client-imagebuilder");
var import_client_ssm = require("@aws-sdk/client-ssm");

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

// src/providers/ami-root-device.lambda.ts
var ssm = new import_client_ssm.SSMClient();
var ec2 = new import_client_ec2.EC2Client();
var ib = new import_client_imagebuilder.ImagebuilderClient();
async function handleAmi(event, ami) {
  const imageDescs = await ec2.send(new import_client_ec2.DescribeImagesCommand({ ImageIds: [ami] }));
  if (imageDescs.Images?.length !== 1) {
    await customResourceRespond(event, "FAILED", `${ami} doesn't exist`, "ERROR", {});
    return;
  }
  const rootDevice = imageDescs.Images[0].RootDeviceName;
  if (!rootDevice) {
    await customResourceRespond(event, "FAILED", `${ami} has no root device`, "ERROR", {});
    return;
  }
  console.log({
    notice: "Resolved AMI root device",
    ami,
    rootDevice
  });
  await customResourceRespond(event, "SUCCESS", "OK", rootDevice, {});
  return;
}
async function handler(event, context) {
  try {
    console.log({
      notice: "CloudFormation custom resource request",
      ...event,
      ResponseURL: "..."
    });
    const ami = event.ResourceProperties.Ami;
    switch (event.RequestType) {
      case "Create":
      case "Update":
        if (ami.startsWith("ami-")) {
          console.log({
            notice: "Checking AMI",
            ami
          });
          await handleAmi(event, ami);
          break;
        }
        if (ami.startsWith("resolve:ssm:")) {
          const ssmParam = ami.substring("resolve:ssm:".length);
          console.log({
            notice: "Checking SSM",
            ssmParam
          });
          const ssmValue = (await ssm.send(new import_client_ssm.GetParameterCommand({ Name: ssmParam }))).Parameter?.Value;
          if (!ssmValue) {
            await customResourceRespond(event, "FAILED", `${ami} has no value`, "ERROR", {});
            break;
          }
          await handleAmi(event, ssmValue);
          break;
        }
        if (ami.startsWith("ssm:")) {
          const ssmParam = ami.substring("ssm:".length);
          console.log({
            notice: "Checking SSM",
            ssmParam
          });
          const ssmValue = (await ssm.send(new import_client_ssm.GetParameterCommand({ Name: ssmParam }))).Parameter?.Value;
          if (!ssmValue) {
            await customResourceRespond(event, "FAILED", `${ami} has no value`, "ERROR", {});
            break;
          }
          await handleAmi(event, ssmValue);
          break;
        }
        if (ami.startsWith("lt-")) {
          console.log({
            notice: "Checking Launch Template",
            launchTemplateId: ami
          });
          const lts = await ec2.send(new import_client_ec2.DescribeLaunchTemplateVersionsCommand({ LaunchTemplateId: ami, Versions: ["$Latest"] }));
          if (lts.LaunchTemplateVersions?.length !== 1) {
            await customResourceRespond(event, "FAILED", `${ami} doesn't exist`, "ERROR", {});
            break;
          }
          if (!lts.LaunchTemplateVersions[0].LaunchTemplateData?.ImageId) {
            await customResourceRespond(event, "FAILED", `${ami} doesn't have an AMI`, "ERROR", {});
            break;
          }
          await handleAmi(event, lts.LaunchTemplateVersions[0].LaunchTemplateData.ImageId);
          break;
        }
        if (ami.match("^arn:aws[^:]*:imagebuilder:[^:]+:[^:]+:image/.*$")) {
          console.log({
            notice: "Checking Image Builder",
            imageBuildVersionArn: ami
          });
          const img = await ib.send(new import_client_imagebuilder.GetImageCommand({ imageBuildVersionArn: ami }));
          const actualAmi = img.image?.outputResources?.amis?.[0]?.image;
          if (!actualAmi) {
            await customResourceRespond(event, "FAILED", `${ami} doesn't have an AMI`, "ERROR", {});
            break;
          }
          await handleAmi(event, actualAmi);
          break;
        }
        await customResourceRespond(event, "FAILED", `Unknown type of AMI ${ami}`, "ERROR", {});
        break;
      case "Delete":
        console.log({
          notice: "Nothing to delete",
          ami
        });
        await customResourceRespond(event, "SUCCESS", "OK", event.PhysicalResourceId, {});
        break;
    }
  } catch (e) {
    console.error({
      notice: "Failed to resolve AMI root device",
      error: e
    });
    await customResourceRespond(event, "FAILED", e.message || "Internal Error", context.logStreamName, {});
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
