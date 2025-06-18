import {
  CloudWatchLogsClient,
  PutLogEventsCommand,
  CreateLogStreamCommand,
} from "@aws-sdk/client-cloudwatch-logs";

export default async (req, res, next) => {
  // Exclude API endpoints from logging
  if (req.originalUrl !== "/healthCheck" && req.method !== "OPTIONS") {
    // Send audit log to CloudWatch
    res.once("finish", async () => {
      if (
        process.env.CW_LOG_LEVEL === "audit" ||
        (process.env.CW_LOG_LEVEL === "error" && res.statusCode !== 200)
      ) {
        // Set Log Stream name for today's date
        const lsName = `logstream-${new Date().toLocaleDateString("sv-SE")}`;

        // This function submit log to CloudWatch
        const putCwLogs = async (log) => {
          try {
            // Initialize CloudWatch client
            const client = new CloudWatchLogsClient({
              apiVersion: "2014-03-28",
              region: process.env.awsCloudWatchRegion,
            });

            // Define CloudWatch command
            const command = new PutLogEventsCommand(log);

            // Send CloudWatch log (event)
            await client.send(command);
            return { status: "success" };
          } catch (err) {
            console.log(`ERROR: CloudWatch Logs - ${err}`);
            return { status: "fail", message: err.__type };
          }
        };

        // This function creates log stream in CloudWatch Group
        const createLogStream = async () => {
          try {
            // Initialize CloudWatch client
            const client = new CloudWatchLogsClient({
              apiVersion: "2014-03-28",
              region: process.env.awsCloudWatchRegion,
            });

            // Set data to pass to the command
            const params = {
              logGroupName: process.env.awsCloudWatchLogGroup,
              logStreamName: lsName,
            };

            const command = new CreateLogStreamCommand(params);

            // Send command to AWS
            await client.send(command);

            console.log(`INFO: Created Log Stream ${lsName}`);

            return { status: "success" };
          } catch (err) {
            console.log(`ERROR: CloudWatch Log Stream - ${err} ${err.stack}`);

            return { status: "fail", message: err.__type };
          }
        };

        // Format log message
        const logMsg = {
          logEvents: [
            {
              message: JSON.stringify({
                userIdentity: {
                  username: req.username ? req.username : "anonymous",
                },
                eventTime: new Date(Date.now()),
                eventSource: "CUCX_Client_Portal_API",
                eventType: "log",
                sourceIPAddress: req.ip,
                reqMethod: req.method,
                reqUrl: req.originalUrl,
                reqBody: req.body && req.body,
                resStatusCode: res.statusCode,
                resStatusMessage: res.statusMessage,
                ...(req.localError?.cid && { errorId: req.localError.cid }),
                ...(req.localError?.debugMessage && {
                  debugMessage: req.localError.debugMessage,
                }),
                ...(req.localError?.stack && { errorStack: req.localError.stack }),
              }),
              timestamp: Date.now(),
            },
          ],
          logGroupName: process.env.awsCloudWatchLogGroup,
          logStreamName: lsName,
        };

        // Submit log to CW
        const putLogOutcome = await putCwLogs(logMsg);

        // If log stream does not exist, create one.
        // Calls to non exisiting log group returns 400 'AccessDeniedException'
        if (putLogOutcome.message === "ResourceNotFoundException") {
          const createStreamOutocme = await createLogStream();

          // If logstream created, re-submit the log
          if (createStreamOutocme.status === "success") {
            await putCwLogs(logMsg);
          }
        }
      }
    });
  }
  next();
};
