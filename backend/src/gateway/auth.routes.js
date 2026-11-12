import { Router } from 'express';
import { login, listMockUsers, getCurrentUser } from './auth.controller.js';
import { authGateway } from './auth.middleware.js';

const router = Router();

router.post('/login', login);
router.get('/mock-users', listMockUsers);
router.get('/me', authGateway, getCurrentUser);

export default router;
