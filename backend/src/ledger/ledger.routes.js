import { Router } from 'express';
import { authenticate } from '../gateway/authMiddleware.js';
import { resolveTenant, tenantContext } from '../gateway/tenantMiddleware.js';
import * as ctrl from './ledger.controller.js';

const router = Router();

// All ledger routes require authentication + tenant context
router.use(authenticate, resolveTenant, tenantContext);

router.post('/transactions', ctrl.createTransaction);
router.get('/transactions', ctrl.listTransactions);
router.get('/transactions/:id', ctrl.getTransaction);

export default router;
