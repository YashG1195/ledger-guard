export async function getSummary(tenantId, query, log) {
  log.info({ tenantId, query }, 'analyticsService.getSummary');
  // TODO: MongoDB aggregation — group by type, sum amounts, filter by dateRange
  return { total: 0, credited: 0, debited: 0, currency: 'USD' };
}

export async function getTrends(tenantId, query, log) {
  log.info({ tenantId, query }, 'analyticsService.getTrends');
  // TODO: Time-series bucketing ($dateTrunc) aggregation pipeline
  return { buckets: [], granularity: query.granularity ?? 'day' };
}
