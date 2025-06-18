import { v4 as uuidv4 } from "uuid";

// Include stack when returning errors in development mode
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    errorId: err.cid,
    error: err,
    message: err.message,
    debugMessage: err.debugMessage,
    stack: err.stack,
  });
};

// Send short version without error stack when in production
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      errorId: err.cid,
      message: err.message,
    });

    // Programming or other unknown error: don't leak error details
  } else {
    // 1) Log error
    // eslint-disable-next-line no-console
    console.error("ERROR", err);

    // 2) Send generic message
    res.status(500).json({
      status: "error",
      errorId: err.cid,
      message: "Something went very wrong!",
    });
  }
};

export default (err, req, res, next) => {
  err.cid = uuidv4();
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";
  req.localError = { debugMessage: err.debugMessage, stack: err.stack, cid: err.cid };

  process.env.NODE_ENV === "development" ? sendErrorDev(err, res) : sendErrorProd(err, res);
};
