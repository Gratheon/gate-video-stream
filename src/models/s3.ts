// Load the AWS SDK for Node.js
import AWS, { S3 } from "aws-sdk";
import { ManagedUpload } from "aws-sdk/clients/s3";
import fs from "fs";

import {logger} from '../logger';
import config from "../config/index";

export default async function upload(
  fileStream,
  // sourceLocalFilePath,
  targetS3FilePath
): Promise<ManagedUpload.SendData> {
  // Set the region
  AWS.config.update({
    accessKeyId: config.aws.key,
    secretAccessKey: config.aws.secret,
    region: "eu-central-1",
  });

  // Create S3 service object
  let s3 = new AWS.S3({ apiVersion: "2006-03-01" });

  // call S3 to retrieve upload file to specified bucket
  let uploadParams: S3.Types.PutObjectRequest;

  // Configure the file stream and obtain the upload parameters

  // var fileStream = fs.createReadStream(sourceLocalFilePath);
  // fileStream.on("error", function (err) {
  //   logger.error("File Error", err);
  // });

  uploadParams = {
    Bucket: config.aws.bucket,
    Body: fileStream,
    Key: targetS3FilePath,
  };

  // call S3 to retrieve upload file to specified bucket

  const result: ManagedUpload.SendData = await new Promise(
    (resolve, reject) => {
      s3.upload(uploadParams, function (err, data) {
        if (err) {
          logger.error("Error", err);

          reject(err);
        }

        if (data) {
          logger.info("Upload Success", data.Location);

          resolve(data);
        }
      });
    }
  );

  return result;
}
