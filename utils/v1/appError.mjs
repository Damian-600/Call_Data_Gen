class AppError extends Error {
  constructor(message, statusCode, debugMessage) {
    super(message);

    this.statusCode = statusCode;
    this.debugMessage = debugMessage;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
