import https from "https";
import axios from "axios";

export const postKpisToPipeline = async (auth, data, handler) => {
  try {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const config = {
      headers: {
        Authorization: auth,
      },
      httpsAgent,
      timeout: 5000,
    };

    const response = await axios.post(
      `https://${process.env.DATA_PREPPER_FQDN}/api/v1/${handler}`,
      data,
      config
    );
    return {
      statusCode: response.status,
      body: response.data,
    };
  } catch (err) {
    // Handle error response from server
    if (err.response) {
      return {
        statusCode: err.response.status,
        body: err.response.data,
      };
    }
    // Handle no response from server
    else if (err.request) {
      return {
        statusCode: 500,
        body: err.message ? err.message : "Network Connectivity Issue",
      };
    } else {
      // Handle everything else
      return {
        statusCode: 500,
        body: "Something went wrong!",
      };
    }
  }
};
