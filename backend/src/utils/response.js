export const sendSuccess = (res, data, status = 200) => {
  return res.status(status).json({
    success: true,
    data,
    error: null,
  });
};

export const sendError = (res, code, message, details = null, status = 500) => {
  return res.status(status).json({
    success: false,
    data: null,
    error: {
      code,
      message,
      ...(details !== null && { details }),
    },
  });
};
