import { AdminAuditListener } from './admin-audit.listener';

describe('AdminAuditListener', () => {
  it('logs a kyc_approved action from the user.kyc_tier_changed event', async () => {
    const adminService = { record: jest.fn() };
    const listener = new AdminAuditListener(adminService as never);

    await listener.onKycTierChanged({
      userId: 'user-1',
      previousTier: 'unverified',
      newTier: 'id_verified',
      changedBy: 'admin-1',
    });

    expect(adminService.record).toHaveBeenCalledWith({
      adminId: 'admin-1',
      actionType: 'kyc_approved',
      targetType: 'user',
      targetId: 'user-1',
      detail: { previous_tier: 'unverified', new_tier: 'id_verified' },
    });
  });
});
