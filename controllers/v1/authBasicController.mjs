import catchAsync from "../../utils/v1/catchAsync.mjs";
import AppError from "../../utils/v1/appError.mjs";

export const protect = catchAsync(async (req, res, next) => {
  // Getting token and check if it's there

  let token;

  // 1) Getting token and check if it's there
  if (req.headers.authorization && req.headers.authorization.startsWith("Basic")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next(new AppError("You are not logged in! Please log in to get access.", 401));
  }

  // 2) Check if the username and password exist (decode)
  let decoded = await Buffer.from(token, "base64").toString("ascii");
  decoded = decoded.split(":");

  const username = decoded[0];
  const password = decoded[1];

  if (!username || !password) {
    return next(new AppError("Please provide username and password", 400));
  }

  // Compare query password with database password
  if (username !== process.env.username || password !== process.env.password) {
    return next(new AppError("Incorrect username or password", 401));
  }

  req.username = username;

  next();
});
