import app from "./app.mjs";
import { getSecret } from "./utils/v1/awsSdk.mjs";

(async () => {
  const { statusCode, data } = await getSecret(
    process.env.AWS_SM_APP_SECRET,
    process.env.AWS_SM_CONF_REGION
  );
  // If unable to fetch configuration data for the from AWS SM, console log the error
  if (statusCode !== 200) {
    // Throw if no remote config fetch for process.env
    throw Error("ERROR: Unable to get application configuration data from AWS SM.");
  } else {
    // Parse configuration data to JS object
    const configData = JSON.parse(data);

    // Add configuration data to process.env, for the list of configuration items refere to readme file
    Object.keys(configData).forEach((_key) => {
      process.env[_key] = configData[_key];
    });
    // eslint-disable-next-line no-console
    console.log("INFO: Config data from AWS SM added to environmental variables");
  }
})();

process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! Shutting down...");
  console.log(err.name, err.message, err.stack);
  process.exit(1);
});

console.log(`ENV:  ${process.env.NODE_ENV}`);

const port = process.env.PORT || 8003;

const server = app.listen(port, () => {
  console.log(`App running over HTTP on port ${port}...`);
});

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! Shutting down...");
  console.log(err.name, err.message, err.stack);
  server.close(() => {
    process.exit(1);
  });
});
