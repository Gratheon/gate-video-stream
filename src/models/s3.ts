// Load the AWS SDK for Node.js
import AWS, { S3 } from "aws-sdk";
import { ManagedUpload } from "aws-sdk/clients/s3";

import {logger} from '../logger';
import config from "../config/index";

type AwsConfig = typeof config.aws & Partial<{
  region: string;
  target_upload_endpoint: string;
  s3ForcePathStyle: boolean;
}>;

export default async function upload(
  fileStream,
  // sourceLocalFilePath,
  targetS3FilePath
): Promise<ManagedUpload.SendData> {
  const awsConfig = config.aws as AwsConfig;

  // Set the region
  AWS.config.update({
    accessKeyId: awsConfig.key,
    secretAccessKey: awsConfig.secret,
    region: awsConfig.region || "eu-central-1",
  });

  // Create S3 service object
  let s3 = new AWS.S3({
    apiVersion: "2006-03-01",
    endpoint: awsConfig.target_upload_endpoint || undefined,
    s3ForcePathStyle: !!awsConfig.s3ForcePathStyle,
  });

  // call S3 to retrieve upload file to specified bucket
  let uploadParams: S3.Types.PutObjectRequest;

  // Configure the file stream and obtain the upload parameters

  // var fileStream = fs.createReadStream(sourceLocalFilePath);
  // fileStream.on("error", function (err) {
  //   logger.error("File Error", err);
  // });

  uploadParams = {
    Bucket: awsConfig.bucket,
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
          logger.info("Upload Success", { location: data.Location });

          resolve(data);
        }
      });
    }
  );

  return result;
}
