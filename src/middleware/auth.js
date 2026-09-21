const ROLE_PERMISSIONS = Object.freeze({
  'Super Admin': new Set(['dashboard', 'livestock', 'content', 'inquiries', 'admin-users']),
  'Content Manager': new Set(['dashboard', 'content']),
  'Livestock Manager': new Set(['dashboard', 'livestock']),
  'Inquiry Manager': new Set(['dashboard', 'inquiries'])
});

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session?.admin?.role;
    if (role && roles.includes(role)) return next();
    return res.status(403).render('admin/error', {
      title: 'Access Denied',
      errorMessage: 'Your administrator role does not have permission to manage this section.'
    });
  };
}

function requireSuperAdmin(req, res, next) {
  return requireRole('Super Admin')(req, res, next);
}

module.exports = { ROLE_PERMISSIONS, requireAuth, requireRole, requireSuperAdmin };
