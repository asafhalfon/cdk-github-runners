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

// src/image-builders/aws-image-builder/delete-resources.lambda.ts
var delete_resources_lambda_exports = {};
__export(delete_resources_lambda_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(delete_resources_lambda_exports);
var import_client_ec2 = require("@aws-sdk/client-ec2");
var import_client_ecr = require("@aws-sdk/client-ecr");
var import_client_imagebuilder = require("@aws-sdk/client-imagebuilder");

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

// src/image-builders/aws-image-builder/delete-resources.lambda.ts
var ec2 = new import_client_ec2.EC2Client();
var ecr = new import_client_ecr.ECRClient();
var ib = new import_client_imagebuilder.ImagebuilderClient();
async function deleteResources(props) {
  const buildsToDelete = [];
  const amisToDelete = [];
  const dockerImagesToDelete = [];
  let result = {};
  do {
    result = await ib.send(new import_client_imagebuilder.ListImageBuildVersionsCommand({
      imageVersionArn: props.ImageVersionArn,
      nextToken: result.nextToken
    }));
    if (result.imageSummaryList) {
      for (const image of result.imageSummaryList) {
        if (image.arn) {
          buildsToDelete.push(image.arn);
        }
        for (const output of image.outputResources?.amis ?? []) {
          if (output.image) {
            amisToDelete.push(output.image);
          }
        }
        for (const output of image.outputResources?.containers ?? []) {
          if (output.imageUris) {
            dockerImagesToDelete.push(...output.imageUris);
          }
        }
      }
    }
  } while (result.nextToken);
  for (const imageId of amisToDelete) {
    try {
      console.log({
        notice: "Deleting AMI",
        image: imageId
      });
      const imageDesc = await ec2.send(new import_client_ec2.DescribeImagesCommand({
        Owners: ["self"],
        ImageIds: [imageId]
      }));
      if (imageDesc.Images?.length !== 1) {
        console.warn({
          notice: "Unable to find AMI",
          image: imageId
        });
        continue;
      }
      await ec2.send(new import_client_ec2.DeregisterImageCommand({
        ImageId: imageId,
        DeleteAssociatedSnapshots: true
      }));
    } catch (e) {
      console.warn({
        notice: "Failed to delete AMI",
        image: imageId,
        error: e
      });
    }
  }
  for (const image of dockerImagesToDelete) {
    try {
      console.log({
        notice: "Deleting Docker Image",
        image
      });
      const parts = image.split("/")[1].split(":");
      const repo = parts[0];
      const tag = parts[1];
      await ecr.send(new import_client_ecr.BatchDeleteImageCommand({
        repositoryName: repo,
        imageIds: [
          {
            imageTag: tag
          }
        ]
      }));
    } catch (e) {
      console.warn({
        notice: "Failed to delete docker image",
        image,
        error: e
      });
    }
  }
  for (const build of buildsToDelete) {
    try {
      console.log({
        notice: "Deleting Image Build",
        build
      });
      await ib.send(new import_client_imagebuilder.DeleteImageCommand({
        imageBuildVersionArn: build
      }));
    } catch (e) {
      console.warn({
        notice: "Failed to delete image version build",
        build,
        error: e
      });
    }
  }
}
async function handler(event, _context) {
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
        await customResourceRespond(event, "SUCCESS", "OK", props.ImageVersionArn, {});
        break;
      case "Delete":
        if (event.PhysicalResourceId != "FAIL") {
          await deleteResources(props);
        }
        await customResourceRespond(event, "SUCCESS", "OK", event.PhysicalResourceId, {});
        break;
    }
  } catch (e) {
    console.error({
      notice: "Failed to delete Image Builder resources",
      error: e
    });
    await customResourceRespond(event, "FAILED", e.message || "Internal Error", "FAIL", {});
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
