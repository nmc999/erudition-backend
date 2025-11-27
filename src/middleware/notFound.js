// 404 Not Found Middleware

export const notFound = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      messageZh: `找不到路由 ${req.method} ${req.originalUrl}`
    }
  });
};

export default notFound;
