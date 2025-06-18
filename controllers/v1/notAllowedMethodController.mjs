import AppError from "../../utils/v1/appError.mjs";

export default (req, res, next) => {
  const allowMethods = Object.keys(req.route.methods)
    .filter((item) => item !== "_all")
    .map((item) => item.toUpperCase());

  res.set("Allow", allowMethods.join(", "));

  return next(new AppError("HTTP method is not allowed", 405));
};
