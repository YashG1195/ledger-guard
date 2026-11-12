export async function getSummary(tenantId, query, log) {
  log.info({ tenantId, query }, 'fetching ledger summary');
  return {
    total: 0,
    credited: 0,
    debited: 0,
    currency: 'USD',
  };
}

export async function getTrends(tenantId, query, log) {
  log.info({ tenantId, query }, 'fetching ledger trends');
  return {
    interval: query.granularity || 'day',
    data: [],
  };
}
