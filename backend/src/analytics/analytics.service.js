export async function getSummary(tenantId, query, log, db) {
  log?.info({ tenantId, query }, 'fetching ledger summary');
  if (db?.models?.Transaction) {
    const Transaction = db.models.Transaction;
    const stats = await Transaction.aggregate([
      { $match: { orgId: tenantId, status: 'completed' } },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const summary = stats[0] || { total: 0, count: 0 };
    return {
      total: summary.total,
      count: summary.count,
      currency: 'USD',
      orgId: tenantId,
    };
  }
  return {
    total: 0,
    credited: 0,
    debited: 0,
    currency: 'USD',
  };
}

export async function getTrends(tenantId, query, log, db) {
  log?.info({ tenantId, query }, 'fetching ledger trends');
  if (db?.models?.Transaction) {
    const Transaction = db.models.Transaction;
    const trends = await Transaction.aggregate([
      { $match: { orgId: tenantId, status: 'completed' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return {
      interval: query?.granularity || 'day',
      data: trends,
    };
  }
  return {
    interval: query?.granularity || 'day',
    data: [],
  };
}
