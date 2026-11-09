import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import * as analyticsService from './analytics.service.js';

export const getSummary = asyncHandler(async (req, res) => {
  const result = await analyticsService.getSummary(req.tenantId, req.query, req.log);
  sendSuccess(res, result);
});

export const getTrends = asyncHandler(async (req, res) => {
  const result = await analyticsService.getTrends(req.tenantId, req.query, req.log);
  sendSuccess(res, result);
});
