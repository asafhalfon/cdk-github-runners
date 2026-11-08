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
  CLEANER_PHYSICAL_RESOURCE_ID: () => CLEANER_PHYSICAL_RESOURCE_ID,
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
var CLEANER_PHYSICAL_RESOURCE_ID = "runner-images-deleted-when-builder-is-removed";
var KEEP_IMAGES = 2;
var DELETABLE_IMAGE_STATUSES = [
  "AVAILABLE",
  "DEPRECATED",
  "FAILED",
  "CANCELLED"
];
var MISSING_LAUNCH_TEMPLATE_ERRORS = [
  "InvalidLaunchTemplateId.NotFound",
  "InvalidLaunchTemplateId.Malformed"
];
var MISSING_AMI_ERRORS = [
  "InvalidAMIID.NotFound",
  "InvalidAMIID.Unavailable",
  "InvalidAMIID.Malformed"
];
var MISSING_DOCKER_IMAGE_ERRORS = [
  "RepositoryNotFoundException",
  "ImageNotFoundException"
];
var MISSING_BUILD_ERRORS = [
  "ResourceNotFoundException"
];
async function launchTemplateAmi(launchTemplateId) {
  try {
    const versions = await ec2.send(new import_client_ec2.DescribeLaunchTemplateVersionsCommand({
      LaunchTemplateId: launchTemplateId,
      Versions: ["$Default"]
    }));
    return versions.LaunchTemplateVersions?.[0]?.LaunchTemplateData?.ImageId;
  } catch (e) {
    if (MISSING_LAUNCH_TEMPLATE_ERRORS.includes(e.name)) {
      console.log({
        notice: "Launch template is gone or empty, so no AMI needs to be protected",
        launchTemplate: launchTemplateId,
        error: e.name
      });
      return void 0;
    }
    throw e;
  }
}
async function recipeBuilds(recipeName) {
  const builds = [];
  let listed = 0;
  let versions = {};
  do {
    versions = await ib.send(new import_client_imagebuilder.ListImagesCommand({
      owner: "Self",
      filters: [{ name: "name", values: [recipeName] }],
      includeDeprecated: true,
      nextToken: versions.nextToken
    }));
    for (const version of versions.imageVersionList ?? []) {
      if (!version.arn) {
        continue;
      }
      listed++;
      let result = {};
      do {
        result = await ib.send(new import_client_imagebuilder.ListImageBuildVersionsCommand({
          imageVersionArn: version.arn,
          nextToken: result.nextToken
        }));
        builds.push(...result.imageSummaryList ?? []);
      } while (result.nextToken);
    }
  } while (versions.nextToken);
  console.log({
    notice: "Listed image versions",
    recipe: recipeName,
    versions: listed,
    builds: builds.length
  });
  return builds;
}
function buildDate(build) {
  return (build.dateCreated ? Date.parse(build.dateCreated) : 0) || 0;
}
async function deleteAmi(imageId) {
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
      return true;
    }
    await ec2.send(new import_client_ec2.DeregisterImageCommand({
      ImageId: imageId,
      DeleteAssociatedSnapshots: true
    }));
    return true;
  } catch (e) {
    if (MISSING_AMI_ERRORS.includes(e.name)) {
      console.log({
        notice: "AMI is already gone",
        image: imageId,
        error: e.name
      });
      return true;
    }
    console.warn({
      notice: "Failed to delete AMI",
      image: imageId,
      error: e
    });
    return false;
  }
}
async function deleteDockerImage(image) {
  try {
    console.log({
      notice: "Deleting Docker Image",
      image
    });
    const parts = image.split("/")[1].split(":");
    const repo = parts[0];
    const tag = parts[1];
    if (tag === "latest") {
      console.log({
        notice: "Skipping latest tag as it is shared and still in use",
        image
      });
      return true;
    }
    await ecr.send(new import_client_ecr.BatchDeleteImageCommand({
      repositoryName: repo,
      imageIds: [
        {
          imageTag: tag
        }
      ]
    }));
    return true;
  } catch (e) {
    if (MISSING_DOCKER_IMAGE_ERRORS.includes(e.name)) {
      console.log({
        notice: "Docker image is already gone",
        image,
        error: e.name
      });
      return true;
    }
    console.warn({
      notice: "Failed to delete docker image",
      image,
      error: e
    });
    return false;
  }
}
async function deleteBuild(build) {
  try {
    console.log({
      notice: "Deleting Image Build",
      build
    });
    await ib.send(new import_client_imagebuilder.DeleteImageCommand({
      imageBuildVersionArn: build
    }));
    return true;
  } catch (e) {
    if (MISSING_BUILD_ERRORS.includes(e.name)) {
      console.log({
        notice: "Image build is already gone",
        build,
        error: e.name
      });
      return true;
    }
    console.warn({
      notice: "Failed to delete image version build",
      build,
      error: e
    });
    return false;
  }
}
async function deleteBuilds(builds) {
  const leftBehind = /* @__PURE__ */ new Set();
  for (const build of builds) {
    for (const output of build.outputResources?.amis ?? []) {
      if (output.image && !await deleteAmi(output.image)) {
        leftBehind.add(build);
      }
    }
    for (const output of build.outputResources?.containers ?? []) {
      for (const image of output.imageUris ?? []) {
        if (!await deleteDockerImage(image)) {
          leftBehind.add(build);
        }
      }
    }
  }
  for (const build of builds) {
    if (!build.arn) {
      continue;
    }
    if (leftBehind.has(build)) {
      console.warn({
        notice: "Keeping image build as not everything it produced could be deleted",
        build: build.arn
      });
      continue;
    }
    if (!await deleteBuild(build.arn)) {
      leftBehind.add(build);
    }
  }
  if (leftBehind.size > 0) {
    throw new Error(`Failed to delete ${leftBehind.size} of ${builds.length} runner image builds. See the log for the error of each one.`);
  }
}
async function deleteOldResources(target) {
  if (!target.RecipeName) {
    console.warn({
      notice: "No recipe name, nothing to clean up"
    });
    return;
  }
  let protectedAmi;
  if (target.LaunchTemplateId) {
    try {
      protectedAmi = await launchTemplateAmi(target.LaunchTemplateId);
    } catch (e) {
      console.warn({
        notice: "Unable to read launch template, skipping cleanup so an AMI in use is not deleted",
        launchTemplate: target.LaunchTemplateId,
        error: e
      });
      return;
    }
  }
  const finished = (await recipeBuilds(target.RecipeName)).filter((build) => {
    if (build.state?.status && DELETABLE_IMAGE_STATUSES.includes(build.state.status)) {
      return true;
    }
    console.log({
      notice: "Keeping build as it has not finished yet",
      build: build.arn,
      status: build.state?.status
    });
    return false;
  });
  finished.sort((a, b) => buildDate(b) - buildDate(a));
  const successful = finished.filter((build) => build.state?.status === "AVAILABLE");
  const unsuccessful = finished.filter((build) => build.state?.status !== "AVAILABLE");
  const oldBuilds = unsuccessful.concat(successful.slice(KEEP_IMAGES)).filter((build) => {
    if (protectedAmi && (build.outputResources?.amis ?? []).some((ami) => ami.image === protectedAmi)) {
      console.log({
        notice: "Keeping build as its AMI is used by the launch template",
        build: build.arn,
        image: protectedAmi
      });
      return false;
    }
    return true;
  });
  console.log({
    notice: "Deleting old images",
    recipe: target.RecipeName,
    found: finished.length,
    deleting: oldBuilds.length
  });
  await deleteBuilds(oldBuilds);
}
async function recipeOfImageVersion(imageVersionArn) {
  try {
    const builds = await ib.send(new import_client_imagebuilder.ListImageBuildVersionsCommand({ imageVersionArn }));
    return builds.imageSummaryList?.find((build) => build.name)?.name;
  } catch (e) {
    console.warn({
      notice: "Failed to look up the recipe of an image version",
      image: imageVersionArn,
      error: e
    });
    return void 0;
  }
}
async function deleteAllResources(target) {
  let recipeName = target.RecipeName;
  if (!recipeName) {
    if (!target.ImageVersionArn) {
      console.warn({
        notice: "Neither a recipe name nor an image version to clean up"
      });
      return;
    }
    recipeName = await recipeOfImageVersion(target.ImageVersionArn);
    if (!recipeName) {
      console.warn({
        notice: "No builds left to tell us which recipe to clean up",
        image: target.ImageVersionArn
      });
      return;
    }
    console.log({
      notice: "Found the recipe of a builder last deployed by an older version of this construct",
      image: target.ImageVersionArn,
      recipe: recipeName
    });
  }
  const builds = await recipeBuilds(recipeName);
  console.log({
    notice: "Deleting all images",
    recipe: recipeName,
    deleting: builds.length
  });
  await deleteBuilds(builds);
}
async function handler(event, _context) {
  if (event.RequestType === "Scheduled") {
    console.log({
      notice: "Scheduled image cleanup request",
      ...event
    });
    await deleteOldResources(event);
    return;
  }
  try {
    console.log({
      notice: "CloudFormation custom resource request",
      ...event,
      ResponseURL: "..."
    });
    switch (event.RequestType) {
      case "Create":
        await customResourceRespond(event, "SUCCESS", "OK", CLEANER_PHYSICAL_RESOURCE_ID, {});
        break;
      case "Update":
        await customResourceRespond(event, "SUCCESS", "OK", event.PhysicalResourceId, {});
        break;
      case "Delete":
        await deleteAllResources(event.ResourceProperties);
        await customResourceRespond(event, "SUCCESS", "OK", event.PhysicalResourceId, {});
        break;
    }
  } catch (e) {
    console.error({
      notice: "Failed to delete Image Builder resources",
      error: e
    });
    const physicalResourceId = "PhysicalResourceId" in event && event.PhysicalResourceId || CLEANER_PHYSICAL_RESOURCE_ID;
    await customResourceRespond(event, "FAILED", e.message || "Internal Error", physicalResourceId, {});
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLEANER_PHYSICAL_RESOURCE_ID,
  handler
});
