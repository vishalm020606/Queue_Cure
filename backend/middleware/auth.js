import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'queue_cure_super_secret_key';

export const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ success: false, error: 'Token is invalid or expired.' });
      }
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ success: false, error: 'Authorization token required.' });
  }
};

// Middleware to authorize specific roles
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied: insufficient permissions.' });
    }
    next();
  };
};
