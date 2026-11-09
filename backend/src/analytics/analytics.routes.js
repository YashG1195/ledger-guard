import { Router } from 'express';
import { authenticate } from '../gateway/authMiddleware.js';
import { resolveTenant } from '../gateway/tenantMiddleware.js';
import * as ctrl from './analytics.controller.js';

const router = Router();

router.use(authenticate, resolveTenant);

router.get('/summary', ctrl.getSummary);
router.get('/trends', ctrl.getTrends);

export default router;
