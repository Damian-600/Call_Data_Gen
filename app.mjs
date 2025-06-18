import express from "express";
import morgan from "morgan";
import helmet from "helmet";

import AppError from "./utils/v1/appError.mjs";
import globalErrorHandler from "./controllers/v1/errorController.mjs";
import cloudWatchLogger from "./utils/v1/cloudWatchLogger.mjs";

// Router imports
import defaultRoutes from "./routes/defaultRoutes.mjs";

const app = express();

// GLOBAL MIDDLEWARES
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

/*    SECURITY   */
// Disable x-powered-by header
app.disable("x-powered-by");

app.use(
  helmet({
    frameguard: { action: "deny" },
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], styleSrc: ["'self"] },
    },
    crossOriginEmbedderPolicy: true,
  })
);

app.use(express.json());

// CloudWatch Logger - sends api audit logs to AWS CloudWatch
app.use(cloudWatchLogger);

// Verify and reject request with content-type header different than application/json and multipart/form-data
app.use("/api/", (req, res, next) => {
  const contentType = req.headers["content-type"];
  if (contentType && !(req.is("application/json") || req.is("multipart/form-data"))) {
    next(new AppError(`Request media type is not supported`, 415));
  }
  next();
});

// ROUTERS
app.use("/api/v1", defaultRoutes);

app.get("/healthCheck", (req, res) => {
  res.status(200).send("alive");
});

// Catch all undefined routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

export default app;
