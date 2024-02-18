import fetch from 'node-fetch'; // Assuming you're running this test in a Node.js environment
import FormData from 'form-data';
import * as fs from "fs";
import { describe, expect, it } from '@jest/globals';
import path from 'path';

describe('GraphQL Video Upload Test', () => {
  it('should upload mp4 video file to GraphQL endpoint', async () => {
    const videoFile = 'bees-2mb.mp4';
    const graphqlEndpoint = 'http://localhost:8900/graphql';

    // Read the video file and create a FormData object
    const formData = new FormData();

    // Add GraphQL query as the 'map' field
    formData.append('operations', JSON.stringify({
      query: `
        mutation uploadGateVideo($file: Upload!, $boxId: ID!) {
          uploadGateVideo(file: $file, boxId: $boxId)
        }
      `,
      variables: {
        file: null,
        boxId: 1
      }
    }));

    // Add a map of file names to file objects
    formData.append('map', JSON.stringify({
      "0": ["variables.file"]
    }));

    // Add the video file
    const fileContents = fs.readFileSync(path.resolve(__dirname, videoFile));
    formData.append('0', fileContents, {
      filename: videoFile,
      contentType: 'video/mp4', // Adjust content type according to your video file
    });

    // Make a POST request to GraphQL endpoint
    const response = await fetch(graphqlEndpoint, {
      method: 'POST',
      body: formData,
      headers: {
        "internal-userid": 1,

        // Adjust headers if required by your GraphQL server
        // Authorization: 'Bearer YOUR_ACCESS_TOKEN',
        // other headers...
        ...formData.getHeaders(),
      },
    });
    
    // You might want to parse and inspect the response body if required
    const responseBody = await response.json();
    console.log(responseBody);


    // Assert response status
    expect(response.status).toBe(200); // Adjust the status code as per your server's response
  });
});
